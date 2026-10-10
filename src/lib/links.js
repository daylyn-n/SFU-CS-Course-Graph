// Outbound links shared across the app.

const RMP_SCHOOL_ID = 1482; // Simon Fraser University on ratemyprofessors.com

/** Rate My Professors search for an instructor at SFU (RMP has no public API for direct profiles). */
export const rmpUrl = (name) =>
  `https://www.ratemyprofessors.com/search/professors/${RMP_SCHOOL_ID}?q=${encodeURIComponent(name)}`;
