import bcrypt from 'bcryptjs'

/**
 * 12 rounds: comfortably above bcrypt's default 10 without making the demo's
 * login feel slow on a free Render instance.
 */
const ROUNDS = 12

export const hashPassword = (plain: string): Promise<string> =>
  bcrypt.hash(plain, ROUNDS)

export const verifyPassword = (
  plain: string,
  hash: string,
): Promise<boolean> => bcrypt.compare(plain, hash)

/**
 * A hash of a value nobody will ever submit, compared against when the email
 * is unknown. Without this, "no such user" returns in ~1ms while a real
 * user's wrong password takes ~150ms, and that gap enumerates accounts.
 */
const DUMMY_HASH = '$2a$12$C6UzMDM.H6dfI/f/IKcEe.CbEZ4hHFDdKvHRLtVvvvL4tG5g4qO4a'

export const wasteTimeLikeAVerify = async (): Promise<void> => {
  await bcrypt.compare('not-the-password', DUMMY_HASH)
}
