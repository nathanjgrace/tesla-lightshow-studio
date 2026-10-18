// Tesla's official example shows, loaded at runtime from Tesla's GitHub repo
// (pinned to a commit so they can't change under us). Tesla publishes them
// without a license, so we link to them instead of re-hosting copies.

export const TESLA_REPO_COMMIT = '9f949512146d881b6eb66d042b22ee3f9e115afb';

/** Where example files come from. Override with VITE_LIBRARY_BASE for local testing. */
export const LIBRARY_BASE: string =
  import.meta.env.VITE_LIBRARY_BASE ??
  `https://raw.githubusercontent.com/teslamotors/light-show/${TESLA_REPO_COMMIT}/examples/`;

export type ShowSource =
  /** One zip containing lightshow.fseq and lightshow.wav/.mp3. */
  | { kind: 'zip'; path: string }
  /** One folder per car: `<folder>/Car #<n>/LightShow/lightshow.fseq` plus audio. */
  | { kind: 'cars'; folder: string; audioFile: string };

export interface LibraryShow {
  id: string;
  title: string;
  credit: string;
  cars: number;
  /** Approximate download size for one car, shown before loading. */
  downloadMB: number;
  source: ShowSource;
}

export const LIBRARY: readonly LibraryShow[] = [
  {
    id: 'elevator-music',
    title: 'Elevator Music',
    credit: 'Tesla example',
    cars: 1,
    downloadMB: 7.5,
    source: { kind: 'zip', path: 'lightshow_example_1_elevator_music.zip' },
  },
  {
    id: 'auld-lang-syne',
    title: 'Auld Lang Syne in the City',
    credit: 'Max Carlisle · Tesla example',
    cars: 1,
    downloadMB: 20,
    source: { kind: 'zip', path: 'lightshow_example_2_Max_Carlisle_Auld_Lang_Syne_In_the_City.zip' },
  },
  {
    id: 'the-arrival',
    title: 'The Arrival',
    credit: 'Tesla example',
    cars: 5,
    downloadMB: 2.6,
    source: { kind: 'cars', folder: 'lightshow_example_3_The_Arrival_5_Car', audioFile: 'lightshow.mp3' },
  },
  {
    id: 'ready-for-assault',
    title: 'Ready for Assault',
    credit: 'Tesla example',
    cars: 8,
    downloadMB: 25,
    source: { kind: 'cars', folder: 'lightshow_example_4_Ready_for_Assault_8_Car', audioFile: 'lightshow.wav' },
  },
  {
    id: 'cyber-symphony',
    title: 'Cyber Symphony',
    credit: 'Tesla example',
    cars: 4,
    downloadMB: 16,
    source: { kind: 'cars', folder: 'lightshow_example_5_Cyber_Symphony_4_Car', audioFile: 'lightshow.wav' },
  },
];

export const DEFAULT_SHOW_ID = 'elevator-music';
