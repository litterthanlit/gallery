export type Work = {
  id: string;
  title: string;
  year: number;
  src: string;
  note?: string;
};

export const works: Work[] = [
  {
    id: "chaos",
    title: "Chaos",
    year: 2024,
    src: "/works/chaos.jpg",
  },
  {
    id: "emptiness-surrounding-me",
    title: "Emptiness Surrounding Me",
    year: 2024,
    src: "/works/emptiness-surrounding-me.jpg",
  },
  {
    id: "in-the-fire",
    title: "In the Fire",
    year: 2024,
    src: "/works/in-the-fire.jpg",
  },
  {
    id: "shattered",
    title: "Shattered",
    year: 2024,
    src: "/works/shattered.jpg",
  },
  {
    id: "unfiltered-projections",
    title: "Unfiltered Projections",
    year: 2024,
    src: "/works/unfiltered-projections.jpg",
  },
  {
    id: "untitled-i",
    title: "Untitled I",
    year: 2024,
    src: "/works/untitled-i.jpg",
  },
  {
    id: "untitled-ii",
    title: "Untitled II",
    year: 2024,
    src: "/works/untitled-ii.jpg",
  },
  {
    id: "compulsive-panic",
    title: "Compulsive Panic",
    year: 2025,
    src: "/works/compulsive-panic.jpeg",
  },
  {
    id: "current-obsession",
    title: "Current Obsession",
    year: 2025,
    src: "/works/current-obsession.jpeg",
  },
];
