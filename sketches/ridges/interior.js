// The core seven's land, read again (26 Oct 2026) from their coastal photos together with photos of their interiors:
// forest floor, muskeg, tundra valleys, dunes and meadows, pine and granite uplands. Their water is not changed.
// Interior photos are [file, author, licence] on Wikimedia Commons, used only to read colours. Where a place's own
// islands had too few, the nearest same ground stands in, said here: Broken Group by the rainforest of the same
// national park; Georgian Bay by Killarney on its shore; Thousand Islands by Wellesley Island (the same archipelago,
// on the US side); Mahone Bay by Lunenburg County forest and Nova Scotia blueberry barrens.

export const INTERIOR = {
  haidaGwaii: {
    // Forest walks and fern understory with one fungus photo: two of the fungus at first turned the land rust.
    colours: ['#2e3f1d', '#4c4b3a', '#446025', '#627d34', '#b36741', '#8e907b', '#859e3e', '#baad8c', '#a9c143'],
    weights: [0.238, 0.239, 0.221, 0.175, 0.119, 0.189, 0.137, 0.179, 0.096],
    photos: [
      ['Haida Gwaii (Queen Charlotte Islands) - Graham Island - a walk in a second growth Hemlock forest just W of Queen Charlotte City - (21372768699).jpg', 'Murray Foubister', 'CC BY-SA 2.0'],
      ['Haida Gwaii (Queen Charlotte Islands) - Graham Island - nice forest - (21372554670).jpg', 'Murray Foubister', 'CC BY-SA 2.0'],
      ['Haida Gwaii (Queen Charlotte Islands) - Graham Island - on the trail to the Golden Spruce (deceased) - larger Sitka Spruce, even larger stumps and Sanne - (21569615301).jpg', 'Murray Foubister', 'CC BY-SA 2.0'],
      ['Haida Gwaii (Queen Charlotte Islands) - Graham Island - on the trail to the Golden Spruce (deceased) - the spectacular "Chicken of the Woods"mushroom (Laetiporus Sulphureus) - (20938149004).jpg', 'Murray Foubister', 'CC BY-SA 2.0'],
      ['Haida Gwaii 2015 9.jpg', 'Murray Foubister', 'CC BY-SA 2.0'],
    ],
  },
  brokenGroup: {
    colours: ['#262b18', '#394315', '#57544e', '#668232', '#767a81', '#88a54a', '#abb0b8', '#b6d073', '#d4dde6'],
    weights: [0.247, 0.196, 0.175, 0.139, 0.193, 0.122, 0.269, 0.104, 0.254],
    photos: [
      ['Broken Group Islands (5945824403).jpg', 'Roy Luck', 'CC BY 2.0'],
      ['Pacific Rim National Park - Rainforest Trail (3671494518).jpg', 'Kyla Duhamel', 'CC BY 2.0'],
      ['Pacific Rim National Park - Rainforest Trail (3670678277).jpg', 'Kyla Duhamel', 'CC BY 2.0'],
    ],
  },
  arctic: {
    colours: ['#383130', '#574530', '#695b54', '#6b5aa0', '#7e6e69', '#908485', '#a19a9c', '#dbc37e', '#cfcfe1'],
    weights: [0.187, 0.188, 0.307, 0.125, 0.293, 0.257, 0.281, 0.062, 0.176],
    photos: [
      ['Mount Thor, Akshayuk Pass, Baffin Island.jpg', 'Paul Gierszewski', 'CC BY-SA 3.0'],
      ['Akshayuk Pass, Cumberland Peninsula.jpg', 'Doc Searls', 'CC BY 2.0'],
      ['Summit Lake, Akshayuk Pass, Baffin Is.jpg', 'BrettA343', 'CC BY-SA 4.0'],
      ['Midnight Sun Peak from Akshayuk Pass.jpg', 'BrettA343', 'CC BY-SA 4.0'],
    ],
  },
  thirtyThousand: {
    colours: ['#070c08', '#151e16', '#38413d', '#475224', '#606661', '#67712f', '#8e9382', '#a3aaa7', '#d5dad8'],
    weights: [0.139, 0.187, 0.221, 0.173, 0.207, 0.156, 0.186, 0.212, 0.206],
    photos: [
      ['BeausoleilIslandCedarSprings2004.jpg', 'Kavanagh (English Wikipedia)', 'Public domain'],
      ['Wind swept pine - Killarney Provincial Park.JPG', 'Óðinn', 'CC BY-SA 2.5 ca'],
      ['Killarney George Lake.jpg', 'Sergey Pesterev', 'CC BY-SA 4.0'],
      ['Georgian Bay reflection.png', 'Finlays3', 'CC BY-SA 4.0'],
    ],
  },
  thousandIslands: {
    colours: ['#0c140c', '#1e281e', '#424d2f', '#4f6159', '#6b7d76', '#6d853d', '#8d9d9a', '#8cae46', '#b9bbb3'],
    weights: [0.198, 0.269, 0.296, 0.222, 0.182, 0.17, 0.151, 0.108, 0.206],
    photos: [
      ['1000 Islands Tower view July 2015 panorama 5.jpg', 'King of Hearts', 'CC BY-SA 4.0'],
      ['Gfp-new-york-wellesley-island-state-park-pond-on-the-island.jpg', 'Yinan Chen', 'Public domain'],
      ['Gfp-new-york-wellesley-island-state-park-lake-and-island.jpg', 'Yinan Chen', 'Public domain'],
    ],
  },
  magdalen: {
    colours: ['#3f382c', '#56513d', '#736236', '#6d716c', '#827741', '#968a68', '#de8962', '#c1a78f', '#c8d8e1'],
    weights: [0.168, 0.232, 0.237, 0.193, 0.224, 0.255, 0.13, 0.218, 0.199],
    photos: [
      ['Îles-de-la-Madeleine - plage de La Martinique.jpg', 'Gilles Desjardins', 'CC BY-SA 4.0'],
      ['Dune to Sud (15129410922).jpg', 'Hugh Millward', 'CC BY 2.0'],
      ['Îles-de-la-madeleine Quebec banner île du Havre-aux-Maisons.jpg', 'Claude Brochu', 'CC BY-SA 3.0'],
    ],
  },
  mahone: {
    colours: ['#2a2b18', '#605943', '#993216', '#6a7b22', '#707373', '#979d2e', '#9b9a91', '#c7c054', '#b8bfbc'],
    weights: [0.171, 0.195, 0.228, 0.163, 0.235, 0.148, 0.192, 0.135, 0.262],
    photos: [
      ['Lady Slippers in old growth forest near a lake in Lunenburg County, Nova Scotia, Canada.jpg', 'Madereugeneandrew', 'CC BY-SA 3.0'],
      ['Nova Scotia DSC 9870 - The Red Sea!!! (3783837959).jpg', 'Dennis G. Jarvis', 'CC BY-SA 2.0'],
      ['Nova Scotia DSC 9881 - Blueberry Fields (4287976392).jpg', 'Dennis G. Jarvis', 'CC BY-SA 2.0'],
    ],
  },
};
