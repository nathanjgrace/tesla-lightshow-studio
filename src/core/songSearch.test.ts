import { describe, expect, it } from 'vitest';
import {
  artworkAt,
  bestMatch,
  durationMismatch,
  durationWarning,
  formatLength,
  guessFromFileName,
  matchesFileName,
  deezerSearchUrl,
  sameSong,
  parseDeezerResults,
  parseItunesResults,
  searchUrl,
  songInfo,
} from './songSearch';
import { DEEZER_SAMPLE, ITUNES_SAMPLE } from './songSearch.sample';

describe('searchUrl', () => {
  it('asks for songs only', () => {
    const url = new URL(searchUrl('  one more time  '));
    expect(url.origin + url.pathname).toBe('https://itunes.apple.com/search');
    expect(url.searchParams.get('term')).toBe('one more time');
    expect(url.searchParams.get('media')).toBe('music');
    expect(url.searchParams.get('entity')).toBe('song');
    expect(url.searchParams.get('limit')).toBe('8');
    expect(url.searchParams.has('callback')).toBe(false);
  });

  it('encodes the term and adds options', () => {
    const url = searchUrl('AC/DC & friends', { limit: 3, country: 'gb', callback: '__cb1' });
    expect(url).toContain('term=AC%2FDC+%26+friends');
    expect(url).toContain('limit=3');
    expect(url).toContain('country=gb');
    expect(url).toContain('callback=__cb1');
  });
});

describe('parseItunesResults', () => {
  const songs = parseItunesResults(ITUNES_SAMPLE);

  it('keeps usable songs in order', () => {
    expect(songs.map((s) => `${s.artist} – ${s.title}`)).toEqual([
      'Daft Punk – One More Time',
      'Britney Spears – ...Baby One More Time',
      'Daft Punk – One More Time / Aerodynamic (Live)',
      'blink-182 – ONE MORE TIME',
      'Robin Schulz, Felix Jaehn & Alida – One More Time',
    ]);
  });

  it('maps the fields we use', () => {
    expect(songs[0]).toEqual({
      id: '697195462',
      title: 'One More Time',
      artist: 'Daft Punk',
      album: 'Discovery',
      year: 2000,
      genre: 'Electronic',
      durationMs: 320357,
      source: 'apple',
      previewUrl: expect.stringMatching(/^https:\/\/audio-ssl\.itunes\.apple\.com\/.+\.m4a$/),
      artworkUrl: expect.stringMatching(/100x100bb\.jpg$/),
      trackViewUrl: 'https://music.apple.com/us/album/one-more-time/697194953?i=697195462&uo=4',
    });
  });

  it('survives junk', () => {
    expect(parseItunesResults(undefined)).toEqual([]);
    expect(parseItunesResults('nope')).toEqual([]);
    expect(parseItunesResults({ results: 'nope' })).toEqual([]);
    expect(parseItunesResults({ results: [null, 1, [], {}] })).toEqual([]);
  });

  it('drops missing names or previews, non-http links and duplicates', () => {
    const base = { kind: 'song', trackId: 1, artistName: 'A', trackName: 'T', previewUrl: 'https://x/p.m4a' };
    const parsed = parseItunesResults({
      results: [
        base,
        { ...base }, // duplicate trackId
        { ...base, trackId: 2, trackName: '  ' },
        { ...base, trackId: 3, artistName: undefined },
        { ...base, trackId: 4, previewUrl: 'javascript:alert(1)' },
        { ...base, trackId: 5, trackViewUrl: 'javascript:alert(1)', trackTimeMillis: -5, releaseDate: 'soon' },
      ],
    });
    expect(parsed.map((s) => s.id)).toEqual(['1', '5']);
    expect(parsed[1]).toEqual({ id: '5', title: 'T', artist: 'A', previewUrl: 'https://x/p.m4a', source: 'apple' });
  });
});

describe('Deezer', () => {
  it('builds a JSONP search URL', () => {
    const url = new URL(deezerSearchUrl('  one more time ', { limit: 5, callback: 'cb' }));
    expect(url.origin + url.pathname).toBe('https://api.deezer.com/search');
    expect(Object.fromEntries(url.searchParams)).toEqual({ q: 'one more time', limit: '5', output: 'jsonp', callback: 'cb' });
    expect(new URL(deezerSearchUrl('x')).searchParams.has('output')).toBe(false);
  });

  it('maps tracks, keeping only playable ones with safe links', () => {
    const songs = parseDeezerResults(DEEZER_SAMPLE);
    expect(songs.map((s) => s.title)).toEqual(['One More Time', 'One More Time (Short Radio Edit)']);
    expect(songs[0]).toEqual({
      id: 'deezer:3135553',
      title: 'One More Time',
      artist: 'Daft Punk',
      album: 'Discovery',
      source: 'deezer',
      durationMs: 320000,
      previewUrl: expect.stringMatching(/^https:\/\/cdnt-preview\.dzcdn\.net\/.+\.mp3\?/),
      artworkUrl: expect.stringMatching(/250x250-000000-80-0-0\.jpg$/),
      trackViewUrl: 'https://www.deezer.com/track/3135553',
    });
    expect(songs[1]!.artworkUrl).toBeUndefined();
  });

  it('survives junk', () => {
    expect(parseDeezerResults(undefined)).toEqual([]);
    expect(parseDeezerResults({ data: [null, {}, { type: 'album', title: 'x' }] })).toEqual([]);
    expect(parseDeezerResults({ error: { type: 'Exception', message: 'Quota limit exceeded', code: 4 } })).toEqual([]);
  });
});

describe('artworkAt', () => {
  it('swaps the size in Apple artwork URLs', () => {
    const url = 'https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/5a/source/100x100bb.jpg';
    expect(artworkAt(url, 200)).toBe('https://is1-ssl.mzstatic.com/image/thumb/Music115/v4/5a/source/200x200bb.jpg');
    expect(artworkAt(url.replace('100x100bb', '60x60bb'), 600)).toMatch(/\/600x600bb\.jpg$/);
  });

  it('swaps the size in Deezer artwork URLs', () => {
    const url = 'https://cdn-images.dzcdn.net/images/cover/5718f7c81c27e0b2417e2a4c45224f8a/250x250-000000-80-0-0.jpg';
    expect(artworkAt(url, 100)).toBe('https://cdn-images.dzcdn.net/images/cover/5718f7c81c27e0b2417e2a4c45224f8a/100x100-000000-80-0-0.jpg');
  });

  it('leaves other URLs alone', () => {
    expect(artworkAt('https://example.com/cover.jpg', 200)).toBe('https://example.com/cover.jpg');
  });
});

describe('songInfo', () => {
  it('keeps only the metadata a show stores', () => {
    const info = songInfo(parseItunesResults(ITUNES_SAMPLE)[0]!);
    expect(Object.keys(info).sort()).toEqual(['album', 'artist', 'artworkUrl', 'durationMs', 'source', 'title', 'trackViewUrl']);
  });
});

describe('durations', () => {
  it('formats lengths as m:ss', () => {
    expect(formatLength(225_373)).toBe('3:45');
    expect(formatLength(59_600)).toBe('1:00');
    expect(formatLength(3_725_000)).toBe('1:02:05');
  });

  it('flags files more than 5 s off', () => {
    expect(durationMismatch(225_000, 229_000)).toBeUndefined();
    expect(durationMismatch(192_000, 225_000)).toEqual({ fileMs: 192_000, trackMs: 225_000, diffMs: -33_000 });
    expect(durationMismatch(192_000, undefined)).toBeUndefined();
    expect(durationMismatch(NaN, 225_000)).toBeUndefined();
    expect(durationMismatch(200_000, 225_000, 30_000)).toBeUndefined();
  });

  it('words the warning gently', () => {
    expect(durationWarning(192_000, 225_000)).toBe("Your file is 3:12, but the album version is 3:45. That's fine if it's an edit.");
    expect(durationWarning(400_000, 320_357)).toMatch(/6:40, but the album version is 5:20.+extended or live version/);
    expect(durationWarning(12_000, 320_357)).toBe("Your file is 0:12, but the album version is 5:20. That's fine if it's a clip or a short edit.");
    expect(durationWarning(320_000, 320_357)).toBeUndefined();
  });
});

describe('guessFromFileName', () => {
  it.each([
    ['01 - Daft Punk - One More Time.mp3', 'Daft Punk One More Time'],
    ['Daft_Punk_-_One_More_Time.wav', 'Daft Punk One More Time'],
    ['1-07 Mr. Brightside.m4a', 'Mr. Brightside'],
    ['07. Toto – Africa.flac', 'Toto Africa'],
    ['Daft.Punk.One.More.Time.mp3', 'Daft Punk One More Time'],
    ['Queen - Bohemian Rhapsody (Official Video) [HD].mp3', 'Queen Bohemian Rhapsody'],
    ['Avicii - Levels (Radio Edit) 320kbps.mp3', 'Avicii Levels (Radio Edit)'],
    ['C:\\Music\\Prince - 1999.mp3', 'Prince 1999'],
    ['1999.mp3', '1999'],
    ['blink-182 - ONE MORE TIME.mp3', 'blink-182 ONE MORE TIME'],
  ])('%s → %s', (name, term) => {
    expect(guessFromFileName(name)).toBe(term);
  });
});

describe('matching a dropped file', () => {
  const songs = parseItunesResults(ITUNES_SAMPLE);
  const daft = songs[0]!;

  it('needs both title and artist in the file name', () => {
    expect(matchesFileName(daft, '01 - Daft Punk - One More Time.mp3')).toBe(true);
    expect(matchesFileName(daft, 'daft_punk-one_more_time.wav')).toBe(true);
    expect(matchesFileName(daft, 'One More Time.mp3')).toBe(false);
    expect(matchesFileName(daft, 'Daft Punk - Around the World.mp3')).toBe(false);
  });

  it('ignores featured artists, accents, "The" and version tags', () => {
    expect(matchesFileName({ title: 'One More Time', artist: 'Robin Schulz, Felix Jaehn & Alida' }, 'Robin Schulz - One More Time.mp3')).toBe(true);
    expect(matchesFileName({ title: 'Halo', artist: 'Beyoncé' }, 'Beyonce - Halo.mp3')).toBe(true);
    expect(matchesFileName({ title: 'Blinding Lights', artist: 'The Weeknd' }, 'Weeknd - Blinding Lights.mp3')).toBe(true);
    expect(matchesFileName({ title: 'Levels (Radio Edit)', artist: 'Avicii' }, 'Avicii - Levels.mp3')).toBe(true);
    expect(matchesFileName({ title: 'Thunderstruck', artist: 'AC/DC' }, 'ACDC - Thunderstruck.mp3')).toBe(true);
  });

  it('picks the matching result closest in length', () => {
    const live = songs[2]!;
    expect(bestMatch(songs, 'Daft Punk - One More Time.mp3')).toBe(daft);
    expect(bestMatch(songs, 'Daft Punk - One More Time.mp3', 320_000)).toBe(daft);
    expect(bestMatch(songs, 'Daft Punk - One More Time Aerodynamic Live.mp3', 372_000)).toBe(live);
    expect(bestMatch(songs, 'my song.mp3')).toBeUndefined();
  });
});

describe('matching a song across catalogs', () => {
  const apple = parseItunesResults(ITUNES_SAMPLE)[0]!;
  const deezer = parseDeezerResults(DEEZER_SAMPLE);

  it('finds the same recording, preferring the same version and length', () => {
    expect(sameSong(deezer, apple)?.id).toBe('deezer:3135553');
    const edit = { ...apple, title: 'One More Time (Short Radio Edit)', durationMs: 235_000 };
    expect(sameSong(deezer, edit)?.id).toBe('deezer:3157685');
  });

  it('finds nothing for a different song', () => {
    expect(sameSong(deezer, { title: 'Around the World', artist: 'Daft Punk' })).toBeUndefined();
    expect(sameSong(deezer, { title: 'One More Time', artist: 'Britney Spears' })).toBeUndefined();
  });
});
