// frontend/src/components/ui/SyncWizardModal.tsx
import { useState } from 'react'
import { Upload, CheckCircle2, X, Lock, Music, Disc } from 'lucide-react'

export default function SyncWizardModal({
  onClose,
  onSuccess,
}: {
  onClose: () => void
  onSuccess: () => void
}) {
  const [provider, setProvider] = useState<'apple' | 'spotify'>('apple')
  const [adminKey, setAdminKey] = useState(() => localStorage.getItem('admin_key') || '')
  const [status, setStatus] = useState<string>('')
  const [isUploading, setIsUploading] = useState(false)

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return

    setIsUploading(true)
    setStatus('Processing and enriching high-res album artwork...')
    localStorage.setItem('admin_key', adminKey)

    try {
      let totalAdded = 0
      for (const file of Array.from(files)) {
        const formData = new FormData()
        formData.append('file', file)
        const res = await fetch('/api/sync/upload', {
          method: 'POST',
          headers: { 'X-Admin-Key': adminKey },
          body: formData,
        })
        if (!res.ok) {
          const err = await res.json()
          throw new Error(err.detail || 'Upload failed')
        }
        const data = await res.json()
        totalAdded += data.streams_added || data.tracks_processed || 0
      }
      setStatus(`Success! Imported ${totalAdded.toLocaleString()} records & enriched covers.`)
      onSuccess()
    } catch (err: unknown) {
      setStatus(`Error: ${err instanceof Error ? err.message : 'Upload failed'}`)
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-3xl border border-white/20 bg-zinc-950 p-6 text-white shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <h3 className="text-lg font-black">Sync Your Apple Music or Spotify Data</h3>
          <button onClick={onClose} className="text-zinc-400 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Provider Tabs */}
        <div className="mt-4 grid grid-cols-2 gap-2 text-xs font-bold">
          <button
            onClick={() => setProvider('apple')}
            className={`flex items-center justify-center gap-2 rounded-xl py-2.5 border ${
              provider === 'apple' ? 'border-pink-500 bg-pink-950/50 text-pink-200' : 'border-white/10 text-zinc-400'
            }`}
          >
            <Music className="h-4 w-4" /> Apple Music
          </button>
          <button
            onClick={() => setProvider('spotify')}
            className={`flex items-center justify-center gap-2 rounded-xl py-2.5 border ${
              provider === 'spotify' ? 'border-emerald-500 bg-emerald-950/50 text-emerald-200' : 'border-white/10 text-zinc-400'
            }`}
          >
            <Disc className="h-4 w-4" /> Spotify
          </button>
        </div>

        {/* Step-by-Step Instructions for Non-Technical Users */}
        <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4 text-xs space-y-2 text-zinc-300">
          {provider === 'apple' ? (
            <>
              <div className="font-bold text-white">How to get your Apple Music files:</div>
              <p>1. <b>Full History (Recommended):</b> Visit <span className="text-pink-400">privacy.apple.com</span> &rarr; <i>Request a copy of your data</i> &rarr; check <b>Apple Media Services information</b>. Upload <code className="text-pink-300">Apple Music Play Activity.csv</code>.</p>
              <p>2. <b>Instant Desktop Export:</b> In Apple Music / iTunes on Mac or Windows, click <code className="text-pink-300">File &rarr; Library &rarr; Export Library...</code> and upload your <code className="text-pink-300">Library.xml</code>.</p>
            </>
          ) : (
            <>
              <div className="font-bold text-white">How to get your Spotify files:</div>
              <p>1. Visit <span className="text-emerald-400">spotify.com/account/privacy</span> and scroll down to <b>Download your data</b>.</p>
              <p>2. Request your <b>Account Data</b> or <b>Extended Streaming History</b>.</p>
              <p>3. Unzip the archive and select one or more <code className="text-emerald-300">Streaming_History_Audio_*.json</code> or <code className="text-emerald-300">StreamingHistory_music_*.json</code> files below.</p>
            </>
          )}
        </div>

        {/* Optional Admin Key for Deployed Production Security */}
        <div className="mt-4">
          <label className="flex items-center gap-1.5 text-[11px] text-zinc-400 mb-1">
            <Lock className="h-3 w-3" /> Admin Passphrase (Only required if ADMIN_SECRET is set on server)
          </label>
          <input
            type="password"
            value={adminKey}
            onChange={(e) => setAdminKey(e.target.value)}
            placeholder="Leave blank for local dev..."
            className="w-full rounded-xl border border-white/15 bg-black px-3 py-2 text-xs text-white"
          />
        </div>

        {/* Drag and Drop File Zone */}
        <label className="mt-4 flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-white/25 bg-white/5 py-8 cursor-pointer hover:border-purple-400 hover:bg-white/10 transition">
          <Upload className="h-7 w-7 text-purple-400 mb-2" />
          <span className="text-xs font-bold">
            {isUploading ? 'Importing & Enriching Covers...' : 'Click to Select .CSV, .XML, or .JSON Files'}
          </span>
          <span className="text-[11px] text-zinc-400 mt-1">Supports selecting multiple files at once</span>
          <input
            type="file"
            multiple
            accept=".csv,.xml,.json"
            onChange={handleFileUpload}
            disabled={isUploading}
            className="hidden"
          />
        </label>

        {status && (
          <div className="mt-4 flex items-center gap-2 rounded-xl bg-white/10 px-4 py-2.5 text-xs font-semibold text-emerald-300">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>{status}</span>
          </div>
        )}
      </div>
    </div>
  )
}