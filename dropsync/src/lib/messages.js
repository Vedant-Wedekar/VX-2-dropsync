import {
  collection,
  addDoc,
  deleteDoc,
  doc,
  updateDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore'
import { db } from './firebase'
import { uploadToCloudinary } from './cloudinary'
import imageCompression from 'browser-image-compression'

export const EXPIRY_OPTIONS = {
  '1h': 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  never: null,
}

const MAX_IMAGE_BYTES = 20 * 1024 * 1024 // 20MB pre-compression cap

function messagesCol(roomId) {
  return collection(db, 'rooms', roomId, 'messages')
}

export function listenToMessages(roomId, callback, onError) {
  const q = query(messagesCol(roomId), orderBy('createdAt', 'desc'))
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      callback(items)
    },
    (err) => onError?.(err)
  )
}

export async function addTextMessage(roomId, { content, device, expiryMs }) {
  if (!content?.trim()) return
  await addDoc(messagesCol(roomId), {
    type: 'text',
    content: content.slice(0, 20000),
    device: device || 'Unknown',
    createdAt: serverTimestamp(),
    expiresAt: expiryMs ? Timestamp.fromMillis(Date.now() + expiryMs) : null,
    pinned: false,
  })
}

export async function addImageMessage(
  roomId,
  file,
  { device, expiryMs, onProgress }
) {
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error('Image exceeds the 20 MB limit.')
  }

  let toUpload = file
  try {
    if (file.size > 1.5 * 1024 * 1024) {
      toUpload = await imageCompression(file, {
        maxSizeMB: 1.5,
        maxWidthOrHeight: 2560,
        useWebWorker: true,
        initialQuality: 0.82,
      })
    }
  } catch {
    toUpload = file // fall back to original if compression fails
  }

  // Images go to Cloudinary's free tier (no billing account needed) —
  // Firestore only stores the resulting URL + metadata below.
  const { url, publicId, bytes } = await uploadToCloudinary(toUpload, {
    folder: `dropsync/${roomId}`,
    onProgress,
  })

  await addDoc(messagesCol(roomId), {
    type: 'image',
    imageURL: url,
    cloudinaryId: publicId,
    fileName: file.name,
    size: bytes || toUpload.size,
    device: device || 'Unknown',
    createdAt: serverTimestamp(),
    expiresAt: expiryMs ? Timestamp.fromMillis(Date.now() + expiryMs) : null,
    pinned: false,
  })
}

export async function deleteMessage(roomId, message) {
  // Note: deleting the underlying Cloudinary asset requires a signed
  // request (API secret), which can't be done safely from the browser.
  // We remove the message from the room here; the asset itself is
  // cleaned up via Cloudinary's dashboard or a backend job if needed —
  // see README "Image storage" section.
  await deleteDoc(doc(db, 'rooms', roomId, 'messages', message.id))
}

export async function togglePin(roomId, message) {
  await updateDoc(doc(db, 'rooms', roomId, 'messages', message.id), {
    pinned: !message.pinned,
  })
}

/** Deletes any messages in the loaded list whose expiresAt has passed. */
export async function purgeExpired(roomId, messages) {
  const now = Date.now()
  const expired = messages.filter(
    (m) => m.expiresAt && m.expiresAt.toMillis?.() < now
  )
  await Promise.all(expired.map((m) => deleteMessage(roomId, m)))
  return expired.length
}
