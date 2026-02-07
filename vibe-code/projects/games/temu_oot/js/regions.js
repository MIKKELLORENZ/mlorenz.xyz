const regionWidth = 220;
const regionDepth = 180;

const orderedNames = [
  "Kokiri Forest",
  "Hyrule Field",
  "Market / Castle Town",
  "Kakariko Village",
  "Death Mountain",
  "Zora's Domain",
  "Lake Hylia",
  "Gerudo Desert",
  "Lost Woods",
  "Lon Lon Ranch",
];

const ids = [
  "kokiri-forest",
  "hyrule-field",
  "market-castle-town",
  "kakariko",
  "death-mountain",
  "zoras-domain",
  "lake-hylia",
  "gerudo-desert",
  "lost-woods",
  "lon-lon-ranch",
];

const regions = ids.map((id, index) => {
  const startX = index * regionWidth;
  return {
    id,
    name: orderedNames[index],
    path: `sections/${id}.json`,
    index,
    startX,
    centerX: startX + regionWidth / 2,
    width: regionWidth,
    depth: regionDepth,
    loadRadius: regionWidth,
  };
});

const getRegionForX = (x) => {
  return regions.find((region) => x >= region.startX && x < region.startX + region.width) || regions[0];
};

export { regions, getRegionForX, regionWidth, regionDepth };
