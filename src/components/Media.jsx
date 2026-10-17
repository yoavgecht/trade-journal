import { useEffect, useState } from 'react';
import { mediaUrl } from '../api.js';

// <img>/<video> tags can't send Authorization headers, so media is resolved to a
// browser-loadable URL (signed Storage URL on the web) through the authed API.
export function useMediaUrl(name) {
  const [url, setUrl] = useState();
  useEffect(() => {
    let alive = true;
    setUrl(undefined);
    mediaUrl(name).then((u) => { if (alive) setUrl(u); });
    return () => { alive = false; };
  }, [name]);
  return url;
}

export function MediaImg({ name, ...rest }) {
  const url = useMediaUrl(name);
  return <img src={url} {...rest} />;
}

export function MediaVideo({ name, ...rest }) {
  const url = useMediaUrl(name);
  return <video src={url} {...rest} />;
}

// Resolve a list of filenames to URLs (shared lightbox arrays).
export function useMediaUrls(names) {
  const [urls, setUrls] = useState();
  useEffect(() => {
    let alive = true;
    if (!names || !names.length) { setUrls([]); return; }
    Promise.all(names.map((n) => mediaUrl(n))).then((u) => { if (alive) setUrls(u); });
    return () => { alive = false; };
  }, [names]);
  return urls;
}