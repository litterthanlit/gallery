export type Work = {
  id: string;
  title: string;
  year: number;
  src: string;
  width: number;
  height: number;
  note?: string;
};

export const works: Work[] = [
  {
    id: "chaos",
    title: "Chaos",
    year: 2024,
    src: "/works/chaos.jpg",
    width: 1308,
    height: 900,
  },
  {
    id: "emptiness-surrounding-me",
    title: "Emptiness Surrounding Me",
    year: 2024,
    src: "/works/emptiness-surrounding-me.jpg",
    width: 1047,
    height: 1396,
  },
  {
    id: "in-the-fire",
    title: "In the Fire",
    year: 2024,
    src: "/works/in-the-fire.jpg",
    width: 1084,
    height: 1476,
  },
  {
    id: "shattered",
    title: "Shattered",
    year: 2024,
    src: "/works/shattered.jpg",
    width: 1109,
    height: 1443,
  },
  {
    id: "unfiltered-projections",
    title: "Unfiltered Projections",
    year: 2024,
    src: "/works/unfiltered-projections.jpg",
    width: 1334,
    height: 1062,
  },
  {
    id: "untitled-i",
    title: "Untitled I",
    year: 2024,
    src: "/works/untitled-i.jpg",
    width: 1043,
    height: 1538,
  },
  {
    id: "untitled-ii",
    title: "Untitled II",
    year: 2024,
    src: "/works/untitled-ii.jpg",
    width: 1022,
    height: 1494,
  },
  {
    id: "compulsive-panic",
    title: "Compulsive Panic",
    year: 2025,
    src: "/works/compulsive-panic.jpeg",
    width: 2998,
    height: 2397,
  },
  {
    id: "current-obsession",
    title: "Current Obsession",
    year: 2025,
    src: "/works/current-obsession.jpeg",
    width: 2480,
    height: 3508,
  },
];
