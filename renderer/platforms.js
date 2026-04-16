// Platform configuration — shared by the renderer.
// No DOM or Node.js dependencies; loaded as a plain <script> tag.

const PLATFORM_CONFIG = {
  youtube: {
    label: 'YouTube',
    color: '#ff4040',
    urlPatterns: [/youtube\.com/, /youtu\.be/],
    qualityOptions: [
      { value: '2160p', label: '2160p (4K)' },
      { value: '1080p', label: '1080p (FHD)' },
      { value: '720p',  label: '720p (HD)' },
      { value: '480p',  label: '480p' },
      { value: '360p',  label: '360p' },
    ],
    defaultQuality: '1080p',
  },
  twitch: {
    label: 'Twitch',
    color: '#9146ff',
    urlPatterns: [/twitch\.tv\/videos\//],
    qualityOptions: [
      { value: 'source',  label: 'Source (Best)' },
      { value: '720p60',  label: '720p60' },
      { value: '480p30',  label: '480p30' },
      { value: '360p30',  label: '360p30' },
      { value: 'audio',   label: 'Audio Only' },
    ],
    defaultQuality: 'source',
  },
  kick: {
    label: 'Kick',
    color: '#53fc18',
    urlPatterns: [/kick\.com/],
    qualityOptions: [
      { value: 'best',  label: 'Best' },
      { value: '1080p', label: '1080p (FHD)' },
      { value: '720p',  label: '720p (HD)' },
      { value: '480p',  label: '480p' },
      { value: '360p',  label: '360p' },
    ],
    defaultQuality: 'best',
  },
};

function detectPlatform(url) {
  for (const [key, cfg] of Object.entries(PLATFORM_CONFIG)) {
    if (cfg.urlPatterns.some(re => re.test(url))) return key;
  }
  return null;
}
