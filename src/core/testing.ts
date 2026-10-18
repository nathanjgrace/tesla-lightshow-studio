// Helpers for building small shows in tests.

import { CHANNEL_COUNT, channel } from './channels';
import type { FseqFile } from './fseq';

export function blankShow(seconds: number, stepTimeMs = 20): FseqFile {
  const frameCount = Math.round((seconds * 1000) / stepTimeMs);
  return {
    channelCount: CHANNEL_COUNT,
    frameCount,
    stepTimeMs,
    minorVersion: 0,
    uniqueId: 0n,
    variableHeaders: [],
    data: new Uint8Array(frameCount * CHANNEL_COUNT),
  };
}

/** Sets a channel to `value` from fromSec up to (not including) toSec. */
export function fill(show: FseqFile, channelId: string, fromSec: number, toSec: number, value: number): void {
  const { index } = channel(channelId);
  const from = Math.round((fromSec * 1000) / show.stepTimeMs);
  const to = Math.min(show.frameCount, Math.round((toSec * 1000) / show.stepTimeMs));
  for (let f = from; f < to; f++) show.data[f * show.channelCount + index] = value;
}
