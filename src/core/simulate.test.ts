import { describe, expect, it } from 'vitest';
import { CLOSURE_BYTES, LIGHT_BYTES } from './encoding';
import { decodeLight, simulate } from './simulate';
import { blankShow, fill } from './testing';
import { MODEL_3_2017, MODEL_3_2020, MODEL_X_2021 } from './vehicles';

const frameAt = (sec: number) => Math.round((sec * 1000) / 20);

describe('decodeLight', () => {
  it('maps exact and nearby bytes to ramp commands', () => {
    expect(decodeLight(0)).toBe('off');
    expect(decodeLight(178)).toBe('on500');
    expect(decodeLight(255)).toBe('on');
    expect(decodeLight(250)).toBe('on');
  });
});

describe('simulate lights', () => {
  it('turns boolean lights on above 50%', () => {
    const show = blankShow(2);
    fill(show, 'leftFrontFog', 0.5, 1, 128);
    const level = simulate(show, MODEL_X_2021).levels.get('leftFrontFog')!;
    expect(level[frameAt(0.4)]).toBe(0);
    expect(level[frameAt(0.6)]).toBe(1);
    expect(level[frameAt(1.2)]).toBe(0);
  });

  it('ramps up over 1000 ms and stays at full', () => {
    const show = blankShow(4);
    fill(show, 'leftInnerMainBeam', 0, 3, LIGHT_BYTES.on1000);
    const level = simulate(show, MODEL_X_2021).levels.get('leftInnerMainBeam')!;
    expect(level[frameAt(0.5) - 1]).toBeCloseTo(0.5, 1);
    expect(level[frameAt(2)]).toBe(1);
    // Empty timeline afterwards means instant off.
    expect(level[frameAt(3.1)]).toBe(0);
  });

  it('stops short when a 2000 ms ramp is cut off after 1 s', () => {
    const show = blankShow(3);
    fill(show, 'leftInnerMainBeam', 0, 1, LIGHT_BYTES.on2000);
    fill(show, 'leftInnerMainBeam', 1, 3, LIGHT_BYTES.off500);
    const level = simulate(show, MODEL_X_2021).levels.get('leftInnerMainBeam')!;
    expect(level[frameAt(1) - 1]).toBeCloseTo(0.5, 1);
    expect(level[frameAt(1.5)]).toBe(0);
  });

  it('takes channel 5 ramp time from channel 4 on Model X', () => {
    const show = blankShow(3);
    fill(show, 'leftChannel5', 0, 3, LIGHT_BYTES.on);
    fill(show, 'leftChannel4', 0, 3, LIGHT_BYTES.off2000); // ch 4 off, but sets a 2 s ramp
    const sim = simulate(show, MODEL_X_2021);
    expect(sim.levels.get('leftChannel5')![frameAt(1) - 1]).toBeCloseTo(0.5, 1);
    expect(sim.levels.get('leftChannel4')![frameAt(1)]).toBe(0);
  });
});

describe('simulate closures', () => {
  it('opens falcon doors over about 20 s and dances once open', () => {
    const show = blankShow(30);
    fill(show, 'leftFalconDoor', 0, 1, CLOSURE_BYTES.open);
    fill(show, 'leftFalconDoor', 21, 30, CLOSURE_BYTES.dance);
    const door = simulate(show, MODEL_X_2021).closures.get('leftFalconDoor')!;
    expect(door.position[frameAt(10)]).toBeCloseTo(0.5, 1); // keeps opening after the 1 s command
    expect(door.position[frameAt(20.5)]).toBe(1);
    expect(door.dancing[frameAt(23)]).toBe(1);
    expect(door.position[frameAt(23)]).toBeLessThan(1);
  });

  it('ignores dance while not fully open', () => {
    const show = blankShow(10);
    fill(show, 'leftFalconDoor', 0, 10, CLOSURE_BYTES.dance);
    const door = simulate(show, MODEL_X_2021).closures.get('leftFalconDoor')!;
    expect(door.dancing.every((d) => d === 0)).toBe(true);
    expect(door.position.every((p) => p === 0)).toBe(true);
  });

  it('lets windows dance from closed', () => {
    const show = blankShow(5);
    fill(show, 'leftFrontWindow', 0, 5, CLOSURE_BYTES.dance);
    const window = simulate(show, MODEL_X_2021).closures.get('leftFrontWindow')!;
    expect(window.position[frameAt(1)]).toBeGreaterThan(0);
  });

  it('stop freezes a closure mid-travel', () => {
    const show = blankShow(10);
    fill(show, 'liftgate', 0, 1, CLOSURE_BYTES.open);
    fill(show, 'liftgate', 7, 8, CLOSURE_BYTES.stop);
    const gate = simulate(show, MODEL_X_2021).closures.get('liftgate')!;
    expect(gate.position[frameAt(9)]).toBeCloseTo(0.5, 1);
  });
});

describe('simulate mirrors', () => {
  it('start unfolded and fold on Close', () => {
    const show = blankShow(5);
    fill(show, 'leftMirror', 1, 2, CLOSURE_BYTES.close);
    const mirror = simulate(show, MODEL_X_2021).closures.get('leftMirror')!;
    expect(mirror.position[0]).toBe(1);
    expect(mirror.position[frameAt(4)]).toBe(0);
  });
});

describe('combined (OR) lights', () => {
  it('lights all Model 3 aux park and side markers together', () => {
    const show = blankShow(2);
    fill(show, 'leftAuxPark', 0.5, 1, 255);
    const sim = simulate(show, MODEL_3_2020);
    for (const id of ['leftAuxPark', 'rightAuxPark', 'leftSideMarker', 'rightSideMarker']) {
      expect(sim.levels.get(id)![frameAt(0.7)]).toBe(1);
    }
  });

  it('drives the license plate from the tail lights on early Model 3', () => {
    const show = blankShow(2);
    fill(show, 'rightTail', 0.5, 1, 255);
    fill(show, 'licensePlate', 1.2, 1.8, 255); // ignored on these cars
    const early = simulate(show, MODEL_3_2017).levels.get('licensePlate')!;
    expect(early[frameAt(0.7)]).toBe(1);
    expect(early[frameAt(1.5)]).toBe(0);
    const later = simulate(show, MODEL_3_2020).levels.get('licensePlate')!;
    expect(later[frameAt(0.7)]).toBe(0);
    expect(later[frameAt(1.5)]).toBe(1);
  });

  it('keeps Model X lights independent', () => {
    const show = blankShow(2);
    fill(show, 'leftAuxPark', 0.5, 1, 255);
    expect(simulate(show, MODEL_X_2021).levels.get('leftSideMarker')![frameAt(0.7)]).toBe(0);
  });
});
