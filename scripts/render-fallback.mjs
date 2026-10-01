// A render that fails must not cost the day's post (scripts/pipeline.mjs, Steps 4 and 4c).
// One retry, with the optional extras dropped:
//  - 先輩のメイ (`may`): her layer loads audio data and pictures (May.tsx) — a timeout or a bad
//    picture there fails the whole render; without her the video is the plain one (= main's).
//  - tool images (pickup cards): a broken logo / screenshot → text-only cards.
// Jev videos have no images and pickup videos have no May, so in practice one of the two applies.

/** The props for the retry, or null when there is nothing to drop (then the error stands). */
export function fallbackProps(props) {
  const dropMay = props.may === true;
  const dropImages = props.tools.some((t) => t.image);
  if (!dropMay && !dropImages) return null;
  return {
    ...props,
    ...(dropMay ? { may: false } : {}),
    ...(dropImages ? { tools: props.tools.map((t) => ({ ...t, image: null })) } : {}),
  };
}

/** What the retry drops, for the log line. */
export function fallbackLabel(props) {
  return [props.may === true && "先輩のメイ (may:false)", props.tools.some((t) => t.image) && "tool images (text-only cards)"]
    .filter(Boolean)
    .join(" + ");
}

/**
 * `render(props)` throws on failure. Returns the props that rendered — the caller keeps using
 * them, so the cover matches the video (no May on the cover of a video drawn without her).
 */
export function renderWithFallback(props, render, log = console.error) {
  try {
    render(props);
    return props;
  } catch (err) {
    const retry = fallbackProps(props);
    if (!retry) throw err;
    log(`Render failed (${err.message}) — retrying once without ${fallbackLabel(props)}.`);
    render(retry);
    return retry;
  }
}
