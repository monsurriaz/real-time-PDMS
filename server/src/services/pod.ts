import crypto from 'node:crypto'
import mongoose from 'mongoose'
import {
  POD_OTP_LENGTH,
  POD_OTP_MAX_ATTEMPTS,
  POD_OTP_TTL_MS,
  proofOfDeliverySchema,
  type DeliveryStatus,
  type OtpChallenge,
  type OtpIssued,
  type ProofOfDelivery,
  type RecordPodInput,
} from '@pdms/shared'
import type { Actor } from '../lib/context'
import { runAsSystem } from '../lib/context'
import { env } from '../lib/env'
import { DeliveryModel, type PodOtp } from '../models/Delivery'
import { HttpError } from '../middleware/httpError'

/**
 * Proof of delivery capture: photo, code, or signature.
 *
 * What this file does NOT do is decide whether a delivery may become
 * Delivered. Section 5 puts that precondition on the transition, advanceStatus
 * reads `proofOfDelivery` off the record, and the two acts stay separate — so
 * recording proof and moving the status remain distinct, auditable events.
 *
 * The window is unchanged from M3: proof is accepted only while InTransit. A
 * rider who could record proof earlier could sign for a parcel still in the
 * depot, and no amount of photo evidence fixes a record that says otherwise.
 */

/** M3's rule, kept verbatim: proof belongs to a parcel that is out. */
const POD_WINDOW: DeliveryStatus = 'InTransit'

const loadForPod = async (
  deliveryId: string,
): Promise<{ _id: mongoose.Types.ObjectId; status: DeliveryStatus }> => {
  if (!mongoose.Types.ObjectId.isValid(deliveryId)) {
    throw new HttpError(400, 'not a valid delivery id')
  }
  /**
   * Scoped read: role scoping already limits an agent to their own
   * assignments, so someone else's delivery is not found rather than refused.
   * That is the same shape the rest of the delivery routes use.
   */
  const delivery = await DeliveryModel.findById(deliveryId)
    .select('status')
    .lean<{ _id: mongoose.Types.ObjectId; status: DeliveryStatus } | null>()
  if (!delivery) throw new HttpError(404, 'delivery not found')

  if (delivery.status !== POD_WINDOW) {
    throw new HttpError(
      422,
      `proof of delivery can only be recorded while a parcel is in transit — this one is ${delivery.status}`,
    )
  }
  return delivery
}

/**
 * A photo URL is only proof if it is OUR photo.
 *
 * The upload is unsigned and happens in the rider's browser (CLAUDE.md
 * section 2), so the URL arrives from the client. The shared schema has already
 * checked it is a Cloudinary delivery URL; the cloud name is the part only the
 * server knows, and without this check a rider could submit any image on
 * Cloudinary — including one uploaded months ago from somewhere else.
 */
const assertOurCloud = (photoUrl: string): void => {
  const cloud = env.CLOUDINARY_CLOUD_NAME
  if (!cloud) {
    throw new HttpError(
      503,
      'photo proof is not configured — CLOUDINARY_CLOUD_NAME is missing from .env',
    )
  }
  if (!photoUrl.startsWith(`https://res.cloudinary.com/${cloud}/`)) {
    throw new HttpError(422, 'that photo was not uploaded to this project')
  }
}

/**
 * Issue a delivery code.
 *
 * `crypto.randomInt` rather than Math.random: this is a credential, however
 * short-lived, and a predictable one would let a rider guess it without ever
 * speaking to the recipient.
 *
 * The code is NOT returned. The rider is the party the code exists to check,
 * so it goes to the parcel's owner (see the tracking route) and to the server
 * log, which together stand in for the SMS this project has no provider for.
 */
export const issueOtp = async (args: {
  deliveryId: string
  actor: Actor
}): Promise<OtpIssued> => {
  if (args.actor.role === 'customer') {
    throw new HttpError(403, 'only the rider or an admin can request a delivery code')
  }
  const delivery = await loadForPod(args.deliveryId)

  const max = 10 ** POD_OTP_LENGTH
  const code = String(crypto.randomInt(0, max)).padStart(POD_OTP_LENGTH, '0')

  const issuedAt = new Date()
  const expiresAt = new Date(issuedAt.getTime() + POD_OTP_TTL_MS)

  /**
   * A fresh request replaces any outstanding code, attempt counter included.
   * Otherwise a rider who burned five guesses could never recover, and the
   * recipient would be told a code that no longer works.
   */
  const otp: PodOtp = { code, issuedAt, expiresAt, attempts: 0 }
  await DeliveryModel.updateOne(
    { _id: delivery._id, status: POD_WINDOW },
    { $set: { podOtp: otp } },
  )

  // Stands in for the SMS. Deliberately loud: without it a demo on a machine
  // with one browser window has no way to read the code.
  console.log(
    `[pod] delivery code for ${delivery._id.toString()}: ${code} (expires ${expiresAt.toISOString()})`,
  )

  return { issuedAt, expiresAt, attemptsRemaining: POD_OTP_MAX_ATTEMPTS }
}

/**
 * The code as the parcel's owner sees it, or null when there is nothing to
 * show. Callers must have already established that the viewer is not the rider.
 */
export const outstandingChallenge = async (
  deliveryId: mongoose.Types.ObjectId,
): Promise<OtpChallenge | null> => {
  const row = await runAsSystem('pod: outstanding challenge', async () =>
    DeliveryModel.findById(deliveryId)
      // podOtp is select:false, so it must be asked for by name.
      .select('+podOtp status')
      .lean<{ status: DeliveryStatus; podOtp?: PodOtp } | null>()
      .exec(),
  )
  if (!row?.podOtp) return null
  if (row.status !== POD_WINDOW) return null
  if (row.podOtp.expiresAt.getTime() <= Date.now()) return null
  if (row.podOtp.attempts >= POD_OTP_MAX_ATTEMPTS) return null

  return { code: row.podOtp.code, expiresAt: row.podOtp.expiresAt }
}

/** Constant-time compare of two equal-length codes. */
const codesMatch = (a: string, b: string): boolean => {
  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')
  return left.length === right.length && crypto.timingSafeEqual(left, right)
}

/**
 * Verify a code the rider typed in.
 *
 * Every judgement is here, on the server: whether the code matches, whether it
 * has expired, and how many guesses are left. The client sends digits and
 * receives a verdict — it has nothing to compare against, which is the point.
 */
const verifyOtp = async (
  deliveryId: mongoose.Types.ObjectId,
  submitted: string,
): Promise<Date> => {
  const row = await runAsSystem('pod: load challenge', async () =>
    DeliveryModel.findById(deliveryId)
      .select('+podOtp')
      .lean<{ podOtp?: PodOtp } | null>()
      .exec(),
  )
  const otp = row?.podOtp
  if (!otp) {
    throw new HttpError(422, 'no delivery code has been sent for this parcel yet')
  }
  if (otp.expiresAt.getTime() <= Date.now()) {
    throw new HttpError(422, 'that code has expired — send a new one')
  }
  if (otp.attempts >= POD_OTP_MAX_ATTEMPTS) {
    throw new HttpError(429, 'too many wrong codes — send a new one')
  }

  if (!codesMatch(otp.code, submitted)) {
    // The counter is incremented before the refusal is thrown, so a failed
    // attempt costs a guess whatever the caller does with the error.
    await runAsSystem('pod: count wrong attempt', async () =>
      DeliveryModel.updateOne(
        { _id: deliveryId },
        { $inc: { 'podOtp.attempts': 1 } },
      ).exec(),
    )
    const left = POD_OTP_MAX_ATTEMPTS - otp.attempts - 1
    throw new HttpError(
      422,
      left > 0
        ? `that code is not right — ${left} ${left === 1 ? 'try' : 'tries'} left`
        : 'that code is not right, and there are no tries left — send a new one',
    )
  }

  return new Date()
}

/**
 * Record proof. One entry point for all three methods, so the InTransit window
 * and the "write it as a whole record" rule cannot be applied to two of them
 * and forgotten on the third.
 */
export const recordProof = async (args: {
  deliveryId: string
  actor: Actor
  input: RecordPodInput
}): Promise<ProofOfDelivery> => {
  if (args.actor.role === 'customer') {
    throw new HttpError(403, 'only the rider or an admin can record delivery proof')
  }
  const delivery = await loadForPod(args.deliveryId)
  const { input } = args

  const capturedAt = new Date()
  let proof: ProofOfDelivery

  if (input.method === 'photo') {
    assertOurCloud(input.photoUrl)
    proof = {
      method: 'photo',
      photoUrl: input.photoUrl,
      capturedAt,
      ...(input.receivedBy?.trim() ? { receivedBy: input.receivedBy.trim() } : {}),
    }
  } else if (input.method === 'otp') {
    const otpVerifiedAt = await verifyOtp(delivery._id, input.code)
    proof = {
      method: 'otp',
      otpVerifiedAt,
      capturedAt,
      ...(input.receivedBy?.trim() ? { receivedBy: input.receivedBy.trim() } : {}),
    }
  } else {
    proof = {
      method: 'signature',
      receivedBy: input.receivedBy.trim(),
      capturedAt,
    }
  }

  /**
   * Validated against the shared schema before it is stored. The route already
   * parsed the INPUT; this checks the RECORD, which is a different shape and
   * the one the Delivered precondition will read later.
   */
  const validated = proofOfDeliverySchema.parse(proof)

  const written = await DeliveryModel.updateOne(
    // Conditional on the window: the status cannot have moved between the read
    // above and this write.
    { _id: delivery._id, status: POD_WINDOW },
    {
      $set: { proofOfDelivery: validated },
      // A verified code is spent. Removing it means the same code cannot be
      // reused, and stops it lingering on a delivered parcel's record.
      ...(input.method === 'otp' ? { $unset: { podOtp: '' } } : {}),
    },
  )

  if (written.matchedCount === 0) {
    throw new HttpError(409, 'this delivery just changed status — reload and try again')
  }

  return validated
}
