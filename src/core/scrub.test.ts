import { describe, expect, it } from 'vitest';
import { stepFrame, stepTime } from './scrub';

describe('stepTime', () => {
  const beats = [500, 1000, 1500, 2000];
  it('moves to the next or previous beat', () => {
    expect(stepTime(0, 1, beats, 250, 3000)).toBe(500);
    expect(stepTime(700, 1, beats, 250, 3000)).toBe(1000);
    expect(stepTime(1000, 1, beats, 250, 3000)).toBe(1500);
    expect(stepTime(1000, -1, beats, 250, 3000)).toBe(500);
    expect(stepTime(1200, -1, beats, 250, 3000)).toBe(1000);
  });
  it('treats a time a hair off a beat as on it', () => {
    expect(stepTime(999.6, 1, beats, 250, 3000)).toBe(1500);
    expect(stepTime(1000.4, -1, beats, 250, 3000)).toBe(500);
  });
  it('falls back to a fixed step past the grid or without one', () => {
    expect(stepTime(2000, 1, beats, 250, 3000)).toBe(2250);
    expect(stepTime(300, -1, beats, 250, 3000)).toBe(50);
    expect(stepTime(1000, 1, undefined, 250, 3000)).toBe(1250);
    expect(stepTime(1000, -1, [], 250, 3000)).toBe(750);
  });
  it('stays inside the show', () => {
    expect(stepTime(100, -1, undefined, 250, 3000)).toBe(0);
    expect(stepTime(2900, 1, undefined, 250, 3000)).toBe(3000);
  });
});

describe('stepFrame', () => {
  it('lands on frame boundaries', () => {
    expect(stepFrame(0, 1, 20, 1000)).toBe(20);
    expect(stepFrame(30, 1, 20, 1000)).toBe(40);
    expect(stepFrame(40, 1, 20, 1000)).toBe(60);
    expect(stepFrame(30, -1, 20, 1000)).toBe(20);
    expect(stepFrame(40, -1, 20, 1000)).toBe(20);
    expect(stepFrame(0, -1, 20, 1000)).toBe(0);
    expect(stepFrame(990, 1, 20, 1000)).toBe(1000);
  });
});
