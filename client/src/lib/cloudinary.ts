/**
 * Proof-of-delivery photo upload.
 *
 * Straight from the rider's phone to Cloudinary with an unsigned preset
 * (CLAUDE.md section 2), so the image never passes through our server and the
 * database only ever holds the returned URL. Two reasons that shape is right
 * here and not just convenient: the SRS caps what we may keep in Mongo, and
 * Render's free tier is a bad place to funnel megabytes of JPEG.
 */

const CLOUD = import.meta.env?.VITE_CLOUDINARY_CLOUD_NAME as string | undefined
const PRESET = import.meta.env?.VITE_CLOUDINARY_UPLOAD_PRESET as string | undefined

export const photoUploadConfigured = (): boolean =>
  Boolean(CLOUD?.trim()) && Boolean(PRESET?.trim())

/**
 * Longest edge after compression. 1280px is still legible evidence of a parcel
 * at a doorstep, and lands a typical phone photo around 150-250 KB.
 */
const MAX_EDGE = 1280
const QUALITY = 0.72

export interface CompressedPhoto {
  blob: Blob
  /** For the "3.9 MB -> 210 KB" line the rider sees. */
  originalBytes: number
  bytes: number
  width: number
  height: number
}

/**
 * Downscale and re-encode before uploading.
 *
 * A modern phone photo is 4-8 MB. On a Dhaka mobile connection that is a
 * 30-second upload while a rider stands at a door, and the demo would be spent
 * watching a progress bar — so this is not an optimisation, it is the
 * difference between the feature working in the field and not.
 *
 * `createImageBitmap` decodes off the main thread where available; the
 * <img> path is the fallback for anything that lacks it.
 */
export const compressImage = async (file: File): Promise<CompressedPhoto> => {
  const bitmap = await decode(file)

  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
  const width = Math.round(bitmap.width * scale)
  const height = Math.round(bitmap.height * scale)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('this browser cannot process the photo')
  ctx.drawImage(bitmap, 0, 0, width, height)
  if ('close' in bitmap) bitmap.close()

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/jpeg', QUALITY)
  })
  if (!blob) throw new Error('could not compress that photo')

  /**
   * Never upload something larger than what came in. A small screenshot
   * re-encoded as JPEG can grow, and paying for that would be absurd.
   */
  if (blob.size >= file.size) {
    return {
      blob: file,
      originalBytes: file.size,
      bytes: file.size,
      width: bitmap.width,
      height: bitmap.height,
    }
  }

  return { blob, originalBytes: file.size, bytes: blob.size, width, height }
}

/**
 * M9.6: a profile photo, square and small — 256px is plenty for a circle
 * that never renders larger than `--space-14` (56px, ProfileShell's `lg`
 * Avatar) times a couple of device pixels, and a face crop needs no more
 * detail than a parcel-at-the-doorstep photo does at 1280px.
 */
const AVATAR_MAX_EDGE = 256
/** Higher than POD's 0.72: the file is already tiny at this resolution, so
 *  there is headroom to spend on not looking soft. */
const AVATAR_QUALITY = 0.85

/**
 * Centre-cropped to a square, then downscaled to at most 256px a side.
 * Reuses `decode` below rather than a second decode path — the only real
 * difference between a POD photo and an avatar is the crop and the target
 * size, not how the file gets off the phone and onto a canvas.
 */
export const compressAvatar = async (file: File): Promise<CompressedPhoto> => {
  const bitmap = await decode(file)

  const side = Math.min(bitmap.width, bitmap.height)
  const sx = (bitmap.width - side) / 2
  const sy = (bitmap.height - side) / 2
  const size = Math.min(side, AVATAR_MAX_EDGE)

  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('this browser cannot process the photo')
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, size, size)
  if ('close' in bitmap) bitmap.close()

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/jpeg', AVATAR_QUALITY)
  })
  if (!blob) throw new Error('could not compress that photo')

  return { blob, originalBytes: file.size, bytes: blob.size, width: size, height: size }
}

/** Shared by both `compressImage` and `compressAvatar` above — decode once,
 *  one place, rather than a second copy of the createImageBitmap/<img>
 *  fallback dance. */
export const decode = async (file: File): Promise<ImageBitmap | HTMLImageElement> => {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file)
    } catch {
      // Falls through to the <img> path: some browsers refuse certain HEIC or
      // progressive JPEGs here but decode them fine as an element.
    }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('that file is not an image we can read'))
      img.src = url
    })
    return img
  } finally {
    URL.revokeObjectURL(url)
  }
}

export interface UploadedPhoto {
  /** The https delivery URL. This, and only this, is what the server stores. */
  secureUrl: string
  bytes: number
}

interface CloudinaryResponse {
  secure_url?: string
  bytes?: number
  error?: { message?: string }
}

/**
 * POST the compressed image to Cloudinary. `XMLHttpRequest` rather than fetch
 * purely for upload progress — a rider on a slow connection needs to see the
 * bar move, and fetch still cannot report request progress.
 */
export const uploadPhoto = (
  blob: Blob,
  onProgress?: (fraction: number) => void,
): Promise<UploadedPhoto> => {
  if (!photoUploadConfigured()) {
    return Promise.reject(
      new Error(
        'photo upload is not configured — VITE_CLOUDINARY_CLOUD_NAME and VITE_CLOUDINARY_UPLOAD_PRESET are missing',
      ),
    )
  }

  const body = new FormData()
  body.append('file', blob)
  body.append('upload_preset', String(PRESET))
  // Keeps proof photos in their own folder, so they are findable later without
  // trawling the whole media library.
  body.append('folder', 'pdms/pod')

  return new Promise<UploadedPhoto>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `https://api.cloudinary.com/v1_1/${String(CLOUD)}/image/upload`)
    xhr.timeout = 60_000

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total)
    }
    xhr.ontimeout = () => reject(new Error('the upload timed out — check the connection'))
    xhr.onerror = () => reject(new Error('could not reach Cloudinary'))
    xhr.onload = () => {
      let parsed: CloudinaryResponse
      try {
        parsed = JSON.parse(xhr.responseText) as CloudinaryResponse
      } catch {
        reject(new Error(`Cloudinary replied with ${xhr.status}`))
        return
      }
      if (xhr.status >= 200 && xhr.status < 300 && parsed.secure_url) {
        resolve({ secureUrl: parsed.secure_url, bytes: parsed.bytes ?? blob.size })
        return
      }
      /**
       * The most common failure by far is an upload preset that is not set to
       * Unsigned, and Cloudinary says so plainly — so its message is passed
       * through rather than replaced with something generic.
       */
      reject(new Error(parsed.error?.message ?? `Cloudinary refused the upload (${xhr.status})`))
    }
    xhr.send(body)
  })
}

/** 3.9 MB, 212 KB — for the line under the photo tile. */
export const formatBytes = (bytes: number): string =>
  bytes >= 1_048_576
    ? `${(bytes / 1_048_576).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`
