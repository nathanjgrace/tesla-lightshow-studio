// Plain-language facts about a composer row's channels on the current car,
// for the hover card next to the channel names.

import { CHANNELS_BY_ID } from '../core/channels';
import type { VehicleProfile } from '../core/vehicles';

export function channelFacts(profile: VehicleProfile, ids: readonly string[]): string[] {
  const facts: string[] = [];
  const defs = ids.map((id) => CHANNELS_BY_ID.get(id)!).filter(Boolean);
  if (!defs.length) return facts;
  const numbers = defs.map((d) => d.index + 1);
  const first = Math.min(...numbers);
  const last = Math.max(...numbers);
  facts.push(first === last ? `Channel ${first} in the show file` : `Channels ${first}–${last} in the show file`);
  const pc = profile.channels.find((c) => c.id === ids[0]);
  const kind = pc?.kind ?? defs[0]!.kind;
  const def = defs[0]!;
  if (pc?.label && pc.label !== def.name && !pc.row) facts.push(`Tesla's xLights project calls it "${def.name}"`);
  if (kind === 'ramping') facts.push('On, off, or a 0.5, 1 or 2 s fade');
  else if (kind === 'boolean') facts.push('On or off: this car doesn\'t fade it');
  else if (kind === 'dimmable') facts.push(ids.length > 1 ? `${ids.length} LEDs, each its own channel` : 'Any brightness');
  else if (kind === 'rgb') facts.push('Color: red, green and blue channels');
  else if (kind === 'closure' && def.closure) {
    const c = def.closure;
    facts.push(`Opens in about ${c.openSeconds} s, closes in about ${c.closeSeconds} s${c.supportsDance ? '; can dance' : ''}`);
    facts.push(`Up to ${c.commandLimit} open, close or dance commands per show`);
  }
  if (profile.channel4LeadsRamps && /Channel[56]$/.test(def.id)) facts.push('Fades take their timing from Channel 4 on the same side');
  const group = profile.orGroups.find((g) => g.inputs.includes(def.id));
  if (group) {
    const others = group.inputs.filter((id) => id !== def.id).map((id) => CHANNELS_BY_ID.get(id)?.name ?? id);
    facts.push(`One light on this car with ${others.join(', ')}: it's on when any of them is`);
  }
  if (pc?.maybe) facts.push(pc.maybe);
  return facts;
}
