// Unsigned Cloudinary upload — works entirely client-side against
// Cloudinary's free tier, no backend and no billing account required.
// Requires an unsigned upload preset (see README "Image storage" section).

const CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME
const UPLOAD_PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET

export function cloudinaryConfigured() {
  return Boolean(CLOUD_NAME && UPLOAD_PRESET)
}

/**
 * Uploads a file to Cloudinary via XHR (so we get real progress events,
 * which fetch() can't give us for uploads). Resolves with
 * { url, publicId, bytes }.
 */
export function uploadToCloudinary(file, { folder, onProgress } = {}) {
  return new Promise((resolve, reject) => {
    if (!cloudinaryConfigured()) {
      reject(
        new Error(
          'Cloudinary isn\u2019t configured yet \u2014 add VITE_CLOUDINARY_CLOUD_NAME and VITE_CLOUDINARY_UPLOAD_PRESET to .env.'
        )
      )
      return
    }

    const form = new FormData()
    form.append('file', file)
    form.append('upload_preset', UPLOAD_PRESET)
    if (folder) form.append('folder', folder)

    const xhr = new XMLHttpRequest()
    xhr.open(
      'POST',
      `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`
    )

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.((e.loaded / e.total) * 100)
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText)
          resolve({
            url: data.secure_url,
            publicId: data.public_id,
            bytes: data.bytes,
          })
        } catch {
          reject(new Error('Unexpected response from Cloudinary.'))
        }
      } else {
        let message = `Cloudinary upload failed (${xhr.status}).`
        try {
          const data = JSON.parse(xhr.responseText)
          if (data?.error?.message) message = data.error.message
        } catch {
          /* ignore parse failure, use default message */
        }
        reject(new Error(message))
      }
    }

    xhr.onerror = () => reject(new Error('Network error uploading to Cloudinary.'))
    xhr.send(form)
  })
}
