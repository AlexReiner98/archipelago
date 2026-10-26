// Canada's archipelagos, coast to coast to coast, for the study. Each palette was drawn on 26 Oct 2026 from photos
// of the place on Wikimedia Commons, land and water apart: nine land colours from the photos' non-blue pixels, four
// water colours (sea) from their blue ones. Each photo is credited under its place and used only to read its colours.
// Haida Gwaii, the ninth, is in palettes.js. A landform says how its land stands (see FORMS in palettes.js).

const commons = (file, by, license) => ({ page: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(file.replaceAll(' ', '_'))}`, by, license });

export const CANADA = {
  arctic: {
    title: 'Arctic Archipelago', region: 'canada', paper: '#fefaf2', ink: '#221f1d',
    colours: ['#433a33', '#5d4e43', '#735e49', '#756b6b', '#887e7d', '#a38b78', '#b5a49d', '#c9ccdb', '#e4f0fb'],
    weights: [0.225, 0.25, 0.232, 0.258, 0.258, 0.217, 0.198, 0.123, 0.182],
    sea: ['#0e1a4d', '#39476a', '#627295', '#aeb4d0'],
    form: { rise: 1.2, rugged: 0.25, step: 1.1, soft: -0.15, top: 0, cliff: 0.55 }, // fjords and glaciated walls
    photos: [
      commons('Baffin Island Northeast Coast 1997-08-07.jpg', 'Ansgar Walk', 'CC BY-SA 2.5'),
      commons('Patterned ground devon island.jpg', 'Anthonares', 'CC BY-SA 3.0'),
      commons('Truelove Lowlands Devon Island.jpg', 'Martin Brummell', 'CC BY-SA 2.0'),
      commons('Tanquary Fiord 2 1997-08-05.jpg', 'Ansgar Walk', 'CC BY-SA 2.5'),
      commons('Ellesmere Island - River Beauty.jpg', 'Paul Gierszewski', 'CC BY-SA 3.0'),
      commons('Pangnirtung Fiord S 2 2001-07-15.jpg', 'Ansgar Walk', 'CC BY-SA 2.5'),
      commons('Sirmilik Glacier 2 1997-08-06.jpg', 'Ansgar Walk', 'CC BY-SA 2.5'),
    ],
  },
  gulfIslands: {
    title: 'Gulf Islands', region: 'canada', paper: '#e8e4df', ink: '#161610',
    colours: ['#3d3a28', '#4f4d46', '#635b2d', '#615d54', '#807035', '#7e786d', '#b37e2e', '#9d968b', '#bfc2c8'],
    weights: [0.227, 0.222, 0.172, 0.243, 0.127, 0.28, 0.072, 0.192, 0.124],
    sea: ['#3b526c', '#4170af', '#628fce', '#abc5e0'],
    form: { rise: 0.7, rugged: -0.1, step: 1, soft: 0.15, top: 0, cliff: 0.25 }, // rolling, sandstone shores
    photos: [
      commons('Trees during the sunset in Gulf Islands National Park Reserve, Sidney Island, BC, Canada.jpg', 'Michal Klajban', 'CC BY-SA 4.0'),
      commons('Beach across Gulf Island, Saltspring Island, British Columbia, Canada 01.jpg', 'Michal Klajban', 'CC BY-SA 4.0'),
      commons('View from Baynes Peak, Saltspring Island, British Columbia, Canada 04.jpg', 'Michal Klajban', 'CC BY-SA 4.0'),
      commons('Sidney Spit (part of Gulf Islands National Park Reserve), Sidney Island, British Columbia, Canada 07.jpg', 'Michal Klajban', 'CC BY-SA 4.0'),
      commons('Sidney Spit (part of Gulf Islands National Park Reserve), Sidney Island, British Columbia, Canada 09.jpg', 'Michal Klajban', 'CC BY-SA 4.0'),
      commons('Sidney Spit (part of Gulf Islands National Park Reserve), Sidney Island, British Columbia, Canada 10.jpg', 'Michal Klajban', 'CC BY-SA 4.0'),
    ],
  },
  brokenGroup: {
    title: 'Broken Group', region: 'canada', paper: '#fcf7f0', ink: '#0c0908',
    colours: ['#2b2f33', '#4c4f54', '#656365', '#737984', '#858b96', '#9ca0a8', '#adb2bc', '#bec4cf', '#d4e1eb'],
    weights: [0.165, 0.141, 0.147, 0.182, 0.203, 0.248, 0.342, 0.32, 0.231],
    sea: ['#34506b', '#4b6c8d', '#7e98b2', '#bed3e9'],
    form: { rise: 0.45, rugged: 0, step: 0.8, soft: 0.05, top: 0, cliff: 0.5 }, // low rocky islets, steep shores
    photos: [
      commons('Broken Island Group.jpg', 'David Abercrombie', 'CC BY-SA 2.0'),
      commons('Broken Group Islands of Barkley Sound 02.jpg', 'Roy Luck', 'CC BY 2.0'),
      commons('Fishing boat in the Broken Group Islands.jpg', 'Roy Luck', 'CC BY 2.0'),
      commons('Pacific Rim national park.jpg', 'Photoswithdave', 'CC BY-SA 4.0'),
      commons('Kelp in the Broken Group Islands (5946366048).jpg', 'Roy Luck', 'CC BY 2.0'),
    ],
  },
  thirtyThousand: {
    // Georgian Bay, with Tobermory and the Bruce Peninsula (Flowerpot Island, the Grotto, Indian Head Cove) for its
    // turquoise water: the deep from the bay, the shallows from Tobermory's photos alone, so the averaging with the
    // darker bay does not grey them. Boosted brighter than the rest (boost), at the owner's asking.
    title: 'Thirty Thousand Islands', region: 'canada', paper: '#eae6e1', ink: '#040605',
    colours: ['#283434', '#38471d', '#525a58', '#536329', '#676f6c', '#76803d', '#7d8682', '#949e96', '#c5caca'],
    weights: [0.234, 0.155, 0.224, 0.156, 0.211, 0.128, 0.198, 0.215, 0.229],
    sea: ['#1b3547', '#2f6a73', '#5c9fa3', '#89c2ce'],
    boost: { chroma: 1.35, sea: 1.3, lift: 0.05 },
    form: { rise: 0.25, rugged: -0.2, step: 0.7, soft: 0.35, top: 0.3, cliff: 0.1 }, // low glaciated granite whalebacks
    photos: [
      commons('20150705 - 58 - Carling, Ont. - Nias Islands (I think?).jpg', 'Andre Carrotflower', 'CC BY-SA 4.0'),
      commons('20150705 - 60 - The Archipelago, Ont. - Georgian Bay Horizon.jpg', 'Andre Carrotflower', 'CC BY-SA 4.0'),
      commons('20150705 - 72 - The Archipelago, Ont. - Cottage Life in the Thirty Thousand Islands.jpg', 'Andre Carrotflower', 'CC BY-SA 4.0'),
      commons('Georgian Bay Littoral from water pine tree.jpg', 'Oaktree b', 'CC BY-SA 4.0'),
      commons('Flowerpot Island 13.jpg', 'MBi', 'CC BY-SA 4.0'),
      commons('20150704 - 013 - Tobermory, Ont. - Big Tub Harbour looking east.jpg', 'Andre Carrotflower', 'CC BY-SA 4.0'),
      commons('Bruce peninsula national park 4.JPG', 'see Commons page', 'Public domain'),
      commons('The Grotto, Bruce Peninsula National Park, Ontario - panoramio.jpg', 'A J Butler', 'CC BY 3.0'),
      commons('Indian Head Cove.jpg', 'Óðinn', 'CC BY-SA 2.5 ca'),
      commons('Indian Head Cove, Bruce National Park, May 2018.jpg', 'Jaimie Snelgrove', 'CC BY-SA 4.0'),
      commons('Indian Head Cove 2, Bruce National Park, May 2018.jpg', 'Jaimie Snelgrove', 'CC BY-SA 4.0'),
    ],
  },
  thousandIslands: {
    title: 'Thousand Islands', region: 'canada', paper: '#e4e5e0', ink: '#010101',
    colours: ['#0b130a', '#1d270f', '#303e1a', '#415021', '#53612e', '#677638', '#79877d', '#80923f', '#bcbbb5'],
    weights: [0.273, 0.261, 0.234, 0.232, 0.225, 0.162, 0.137, 0.091, 0.253],
    sea: ['#3a627c', '#618fc9', '#82a8c5', '#99c5ee'],
    form: { rise: 0.35, rugged: -0.1, step: 0.8, soft: 0.2, top: 0.4, cliff: 0.5 }, // small wooded granite islets
    photos: [
      commons('Ivy Lea Thousand Islands July 2015 001.jpg', 'King of Hearts', 'CC BY-SA 4.0'),
      commons('Ivy Lea Thousand Islands July 2015 002.jpg', 'King of Hearts', 'CC BY-SA 4.0'),
      commons('Ivy Lea Thousand Islands July 2015 003.jpg', 'King of Hearts', 'CC BY-SA 4.0'),
    ],
  },
  mingan: {
    title: 'Mingan Archipelago', region: 'canada', paper: '#f3e9e0', ink: '#1a1715',
    colours: ['#3e2f20', '#584033', '#6a5347', '#786f68', '#737b2e', '#8c837b', '#b09064', '#c2ac9a', '#d2d6e4'],
    weights: [0.195, 0.218, 0.232, 0.217, 0.138, 0.229, 0.147, 0.167, 0.24],
    sea: ['#2b3a52', '#518bc9', '#7eb7f5', '#c6cee6'],
    form: { rise: 0.45, rugged: 0.1, step: 0.9, soft: -0.1, top: 0.5, cliff: 0.8 }, // limestone monoliths and tables
    photos: [
      commons("Parc national de l'Archipel-de-Mingan, Monolithes.jpg", 'Marc-Lautenbacher', 'CC BY-SA 4.0'),
      commons('012 049 Iles Mingan Niapiscau flore.jpg', 'Nichole Ouellette', 'CC BY 4.0'),
      commons('012 028 Ile Mingan Niapiskau.jpg', 'Nichole Ouellette', 'CC BY 4.0'),
      commons('Mingan Archipelago National Park.jpg', 'Paul Gierszewski', 'Public domain'),
      commons('Monolithes Mingan.jpg', 'Michel Villeneuve', 'CC BY 2.0'),
      commons('Île Nue de Mingan.JPG', 'Hélène Grenier', 'CC BY-SA 3.0'),
    ],
  },
  magdalen: {
    title: 'Magdalen Islands', region: 'canada', paper: '#f1ece5', ink: '#0b090a',
    colours: ['#444538', '#676350', '#7a733e', '#7c7d77', '#968961', '#c57958', '#afa28d', '#e49068', '#c2ccd1'],
    weights: [0.178, 0.243, 0.251, 0.234, 0.3, 0.121, 0.282, 0.14, 0.242],
    sea: ['#406f8e', '#5f75c7', '#7294f9', '#b6d1e5'],
    form: { rise: 0.55, rugged: -0.2, step: 1, soft: 0.25, top: 0.55, cliff: 0.75 }, // red sandstone cliffs, dunes
    photos: [
      commons('Magdalen-cliffside.jpg', 'Aarchiba (English Wikipedia)', 'Public domain'),
      commons('Madeleine cliff.jpg', 'ぐら (Wikivoyage)', 'CC BY-SA 1.0'),
      commons("Érosion aux îles-de-la-Madeleine, l'anse-aux-herbes, Québec, Canada.jpg", 'Marc-Lautenbacher', 'CC BY-SA 4.0'),
      commons('Village Havre-aux-Maisons, Iles des la Madeleine, Canada.jpg', 'Marc-Lautenbacher', 'CC BY-SA 4.0'),
      commons('Havre-Aubert et le Bout du banc - Sandy Hook.jpg', 'Gilles Desjardins', 'CC BY-SA 4.0'),
    ],
  },
  fundyIsles: {
    title: 'Fundy Isles', region: 'canada', paper: '#f9f2eb', ink: '#131412',
    colours: ['#3a372b', '#48493d', '#525b52', '#797b7d', '#8d8c89', '#a5a29b', '#b8b3ad', '#cbc8c1', '#cddfe9'],
    weights: [0.176, 0.196, 0.182, 0.178, 0.186, 0.213, 0.239, 0.278, 0.172],
    sea: ['#46657f', '#5d8cc9', '#82b5ea', '#a7cbfa'],
    form: { rise: 0.8, rugged: 0.05, step: 1, soft: -0.05, top: 0.45, cliff: 0.8 }, // basalt cliffs and tablelands
    photos: [
      commons('Ashburton Head, Grand Manan.jpg', 'Eaubanel', 'CC BY-SA 4.0'),
      commons('Southwest Head, Grand Manan (3750693636).jpg', 'Leonora (Ellie) Enking', 'CC BY-SA 2.0'),
      commons('June 2009 Grand Manan North Head.jpg', 'Hinto', 'CC BY-SA 3.0'),
      commons('Grand Manan - northeast shore.jpg', 'The Cosmonaut', 'CC BY-SA 2.5 ca'),
      commons('Swallowtail Lighthouse - Grand Manan Island NB.jpg', 'Richard Fangrad', 'CC BY 2.0'),
    ],
  },
};
