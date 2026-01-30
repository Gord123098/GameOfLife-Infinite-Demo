const RULES = {
    "Conway's Life": { b: [3], s: [2, 3] },
    "HighLife": { b: [3, 6], s: [2, 3] },
    "Seeds": { b: [2], s: [] },
    "Day & Night": { b: [3, 6, 7, 8], s: [3, 4, 6, 7, 8] },
    "Life without Death": { b: [3], s: [0, 1, 2, 3, 4, 5, 6, 7, 8] },
    "Morley": { b: [3, 6, 8], s: [2, 4, 5] },
    "Anneal": { b: [4, 6, 7, 8], s: [3, 5, 6, 7, 8] },
    "Diamoeba": { b: [3, 5, 6, 7, 8], s: [5, 6, 7, 8] }
};

if (typeof window !== 'undefined') {
    window.RULES = RULES;
}
