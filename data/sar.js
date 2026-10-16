/* SAR (synthetic aperture radar) satellite catalogue with NOMINAL radar parameters (pure data + helpers, UMD).
   *** INFORMATIONAL ONLY. Radar frequencies are nominal values from the sources listed per mission; they are NOT for reception
   *** (SAR downlinks use other bands) and individual modes/satellites differ. A value that could not be verified is null and the
   *** app shows "frequency not verified" rather than a guess.
   Sources: agency / operator documents first (ESA SentiWiki, CSA, JAXA EORC, CONAE, NRSC/ISRO, SSTL, iQPS, Synspective, ICEYE docs),
   then ESA eoPortal and WMO OSCAR (space.oscar.wmo.int). NORAD ids were checked against CelesTrak GP data (celestrak.org).
   Fields per mission: id, name, operator, band, centerFreqMHz, bandwidthMHz (max verified), bandwidthNote, approx (value is approximate),
   polarizations, modes, swathKm + swathMode (nominal swath of a representative mode, used for the approximate ground-track proximity check),
   secondary (extra radar bands), match (name regexp for satellites newer than this list), source (URLs), notes, sats [[noradId, CelesTrak name]],
   noPublicTle [[name, null]]. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SatSar = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var MISSIONS = [
  {
    id: "sentinel-1",
    name: "Sentinel-1",
    operator: "ESA / European Commission (Copernicus)",
    band: "C",
    centerFreqMHz: 5405,
    bandwidthMHz: 100,
    polarizations: "HH, VV, HH+HV, VV+VH (WV: single only)",
    modes: "Stripmap, Interferometric Wide (IW), Extra Wide (EW), Wave (WV)",
    swathKm: 250,
    swathMode: "IW",
    source: ["https://sentiwiki.copernicus.eu/web/s1-mission"],
    notes: "Centre frequency 5.405 GHz; programmable bandwidth 0–100 MHz. Swaths: IW 250 km, SM 80 km, EW 400 km, WV 20×20 km vignettes. Sentinel-1B failed in Dec 2021 (no imaging); CelesTrak still tracks it.",
    sats: [[39634, "SENTINEL-1A"], [41456, "SENTINEL-1B"], [62261, "SENTINEL-1C"], [66315, "SENTINEL-1D"]],
    satNotes: {"41456": "failed Dec 2021 – not imaging"}
  },
  {
    id: "radarsat-2",
    name: "RADARSAT-2",
    operator: "MDA (Canada)",
    band: "C",
    centerFreqMHz: 5405,
    bandwidthMHz: 100,
    polarizations: "HH, VV, HV, VH (quad-pol modes available)",
    modes: "Spotlight, Ultra-Fine, Fine, Standard, Wide, ScanSAR Narrow/Wide, quad-pol",
    swathKm: 100,
    swathMode: "Standard",
    source: ["https://www.asc-csa.gc.ca/eng/satellites/radarsat/technical-features/radarsat-comparison.asp"],
    notes: "Nominal swaths 18–530 km depending on beam mode (Standard 100 km, Fine 50 km, ScanSAR Wide 500 km).",
    sats: [[32382, "RADARSAT-2"]]
  },
  {
    id: "rcm",
    name: "RADARSAT Constellation Mission (RCM)",
    operator: "Canadian Space Agency",
    band: "C",
    centerFreqMHz: 5405,
    bandwidthMHz: 100,
    polarizations: "HH, VV, HV, VH, compact polarimetry",
    modes: "Low/Medium/High/Very-High Resolution, Low Noise, Ship Detection, Spotlight, Quad-Pol",
    swathKm: 125,
    swathMode: "Medium Resolution 30 m",
    source: ["https://www.asc-csa.gc.ca/eng/satellites/radarsat/technical-features/radarsat-comparison.asp"],
    notes: "Nominal swaths 20–500 km depending on beam mode.",
    sats: [[44322, "RCM-1"], [44324, "RCM-2"], [44323, "RCM-3"]]
  },
  {
    id: "terrasar-x",
    name: "TerraSAR-X",
    operator: "DLR / Airbus Defence and Space",
    band: "X",
    centerFreqMHz: 9650,
    bandwidthMHz: 300,
    bandwidthNote: "300 MHz maximum (High-Resolution Spotlight 300 MHz modes); 150 MHz standard",
    polarizations: "single, dual, quad",
    modes: "StripMap, ScanSAR, Spotlight, High-Res Spotlight",
    swathKm: 30,
    swathMode: "StripMap",
    source: ["https://www.eoportal.org/satellite-missions/terrasar-x"],
    notes: "StripMap image width 30 km; ScanSAR ~100 km; Spotlight 10 km.",
    sats: [[31698, "TERRASAR-X"]]
  },
  {
    id: "tandem-x",
    name: "TanDEM-X",
    operator: "DLR / Airbus Defence and Space",
    band: "X",
    centerFreqMHz: 9650,
    bandwidthMHz: 300,
    bandwidthNote: "300 MHz maximum; 150 MHz standard",
    polarizations: "single, dual, quad",
    modes: "StripMap, ScanSAR, Spotlight (bistatic with TerraSAR-X)",
    swathKm: 30,
    swathMode: "StripMap",
    source: ["https://www.eoportal.org/satellite-missions/terrasar-x"],
    notes: "Twin of TerraSAR-X sharing the same instrument design and ground segment (eoPortal).",
    sats: [[36605, "TANDEM-X"]]
  },
  {
    id: "paz",
    name: "PAZ",
    operator: "Hisdesat (Spain)",
    band: "X",
    centerFreqMHz: 9650,
    bandwidthMHz: 300,
    bandwidthNote: "up to 300 MHz instantaneous bandwidth",
    polarizations: null,
    modes: "Stripmap, ScanSAR, Spotlight, High-Resolution Spotlight",
    swathKm: null,
    swathMode: null,
    source: ["https://www.eoportal.org/satellite-missions/paz"],
    notes: "TerraSAR-X-derived platform; polarization options and nominal swath not verified here.",
    sats: [[43215, "PAZ"]]
  },
  {
    id: "cosmo-skymed",
    name: "COSMO-SkyMed (first generation)",
    operator: "ASI / Italian Ministry of Defence",
    band: "X",
    centerFreqMHz: 9600,
    bandwidthMHz: null,
    polarizations: "HH, VV, HV or VH (ping-pong HH/HV or VV/VH)",
    modes: "Spotlight, Stripmap, ScanSAR (wide/huge), Ping-Pong",
    swathKm: 40,
    swathMode: "Stripmap",
    source: ["https://space.oscar.wmo.int/instruments/view/sar_2000"],
    notes: "WMO OSCAR SAR-2000: 9.60 GHz; Stripmap 40 km, ScanSAR 100–200 km, Spotlight 10 km. Chirp bandwidth not stated in that source.",
    sats: [[31598, "COSMO-SKYMED 1"], [32376, "COSMO-SKYMED 2"], [33412, "COSMO-SKYMED 3"], [37216, "COSMO-SKYMED 4"]]
  },
  {
    id: "csg",
    name: "COSMO-SkyMed Second Generation (CSG)",
    operator: "ASI / Italian Ministry of Defence",
    band: "X",
    centerFreqMHz: 9600,
    bandwidthMHz: null,
    polarizations: "single (HH/VV/HV/VH) or dual (HH+HV / VV+VH)",
    modes: "Spotlight, Stripmap, ScanSAR (wide/huge swath), Ping-Pong",
    swathKm: 40,
    swathMode: "Stripmap",
    source: ["https://space.oscar.wmo.int/instruments/view/csg_sar"],
    notes: "WMO OSCAR CSG-SAR: 9.60 GHz; swath 7.3–200 km depending on mode. Chirp bandwidth not stated in that source.",
    sats: [[44873, "CSG-1"], [51444, "CSG-2"], [67304, "CSG-3"]]
  },
  {
    id: "saocom",
    name: "SAOCOM-1",
    operator: "CONAE (Argentina)",
    band: "L",
    centerFreqMHz: 1275,
    bandwidthMHz: 50,
    bandwidthNote: "up to 50 MHz (programmable)",
    polarizations: "single, dual, quad (transmit H or V)",
    modes: "Stripmap, TOPSAR Narrow, TOPSAR Wide",
    swathKm: 150,
    swathMode: "TOPSAR Narrow (single/dual pol)",
    source: ["https://www.eoportal.org/satellite-missions/saocom", "https://calvalportal.ceos.org/html/portal/sarc/documents/documents/CONAE_LF_19nov19_v5.pdf"],
    notes: "Stripmap >65 km per beam; TOPSAR narrow 150/176 km (single/dual pol), 109/110 km (quad).",
    sats: [[43641, "SAOCOM 1A"], [46265, "SAOCOM 1B"]]
  },
  {
    id: "alos-2",
    name: "ALOS-2 (Daichi-2)",
    operator: "JAXA (Japan)",
    band: "L",
    centerFreqMHz: 1257.5,
    bandwidthMHz: 84,
    bandwidthNote: "84 / 42 / 28 / 14 MHz by mode",
    polarizations: "single, dual, full, compact",
    modes: "Spotlight, Stripmap (Ultra-fine/High-sensitive/Fine), ScanSAR",
    swathKm: 50,
    swathMode: "Stripmap Ultra-fine",
    source: ["https://earth.jaxa.jp/files/research/ra/4th_ra_eo/material/EORA4_APPENDIX4-5_ALOS-2_ALOS-4.pdf"],
    notes: "PALSAR-2: 1257.5 MHz (±21 MHz alternates in some modes). Swath: Spotlight 25 km, Stripmap 50–70 km, ScanSAR 350/490 km.",
    sats: [[39766, "ALOS-2"]]
  },
  {
    id: "alos-4",
    name: "ALOS-4 (Daichi-4)",
    operator: "JAXA (Japan)",
    band: "L",
    centerFreqMHz: 1257.5,
    bandwidthMHz: 84,
    bandwidthNote: "84 / 42 / 28 MHz by mode",
    polarizations: "single, dual, quad",
    modes: "Spotlight, Stripmap 3/6/10 m, ScanSAR",
    swathKm: 200,
    swathMode: "Stripmap 3 m (200 km, single/dual pol)",
    source: ["https://earth.jaxa.jp/files/research/ra/4th_ra_eo/material/EORA4_APPENDIX4-5_ALOS-2_ALOS-4.pdf"],
    notes: "PALSAR-3 with digital beamforming: swath up to 200 km in Stripmap, 700 km in ScanSAR.",
    sats: [[60182, "ALOS-4 (DAICHI-4)"]]
  },
  {
    id: "nisar",
    name: "NISAR",
    operator: "NASA / ISRO",
    band: "L",
    centerFreqMHz: 1257.5,
    bandwidthMHz: 84,
    polarizations: "single (HH/VV), dual, compact, quad",
    modes: "L-band and S-band SweepSAR",
    swathKm: null,
    swathMode: null,
    secondary: [{"band": "S", "centerFreqMHz": 3200, "bandwidthMHz": 75}],
    source: ["https://space.oscar.wmo.int/satellites/view/nisar", "https://space.oscar.wmo.int/instruments/view/sar_l_nisar", "https://nisar.jpl.nasa.gov/mission/get-to-know-nisar/"],
    notes: "Two radars: L-band (24 cm wavelength; OSCAR lists 1.2575 GHz, 84 MHz; instrument range 1.215–1.3 GHz) and S-band (9.4 cm; OSCAR lists 3.2 GHz, 75 MHz). OSCAR also lists a 1.2275 GHz / 7 MHz L-band entry and rounds frequencies; nominal values.",
    sats: [[65053, "NISAR"]]
  },
  {
    id: "biomass",
    name: "BIOMASS",
    operator: "ESA",
    band: "P",
    centerFreqMHz: 435,
    bandwidthMHz: 6,
    polarizations: "fully polarimetric (quad)",
    modes: "Stripmap (3 swaths, tomographic/interferometric phases)",
    swathKm: null,
    swathMode: null,
    source: ["https://earth.esa.int/eogateway/missions/biomass/description"],
    notes: "P-band SAR at 435 MHz, 6 MHz bandwidth (ESA Earth Online).",
    sats: [[63772, "BIOMASS"]]
  },
  {
    id: "novasar-1",
    name: "NovaSAR-1",
    operator: "SSTL / UK Space Agency",
    band: "S",
    centerFreqMHz: 3200,
    bandwidthMHz: 90,
    bandwidthNote: "pulse bandwidths 20–90 MHz within the 3100–3300 MHz allocation",
    polarizations: "HH, VV, HV and combinations (up to triple-pol)",
    modes: "Stripmap, ScanSAR, ScanSAR Wide, Maritime",
    swathKm: 20,
    swathMode: "Stripmap 6 m",
    source: ["https://research.csiro.au/cceo/wp-content/uploads/sites/252/2020/09/NovaSAR-1_2017_IEEE.pdf"],
    notes: "Transmit pulses are always centred on 3200 MHz (200 MHz band, 3100–3300 MHz), per the NovaSAR-S IEEE paper. Swaths 20 km (Stripmap) to 400 km (Maritime).",
    sats: [[43619, "NOVASAR 1"]]
  },
  {
    id: "kompsat-5",
    name: "KOMPSAT-5 (Arirang-5)",
    operator: "KARI (South Korea)",
    band: "X",
    centerFreqMHz: 9660,
    bandwidthMHz: 240,
    bandwidthNote: "chirp bandwidth ≤ 240 MHz",
    polarizations: null,
    modes: "High Resolution (5 km), Standard (30 km), Wide Swath",
    swathKm: 30,
    swathMode: "Standard",
    source: ["https://www.terranor.no/ImageData/KOMPSAT-5_Standard_Products_Specifications_v1.2.pdf"],
    notes: "X-band 9.66 GHz SAR (SI Imaging Services product specification). Polarization options not verified here.",
    sats: [[39227, "ARIRANG-5 (KOMPSAT-5)"]]
  },
  {
    id: "eos-04",
    name: "EOS-04 (RISAT-1A)",
    operator: "ISRO",
    band: "C",
    centerFreqMHz: 5400,
    bandwidthMHz: 75,
    bandwidthNote: "chirp bandwidth up to 75 MHz (FRS-1)",
    polarizations: "single, dual, full, hybrid (circular transmit)",
    modes: "FRS-1/FRS-2 Stripmap, MRS ScanSAR, CRS ScanSAR",
    swathKm: 25,
    swathMode: "FRS-1 (full-pol 20 km)",
    source: ["https://www.nrsc.gov.in/nrscnew/assets/pdf/announcements/E04_handbook.pdf", "https://www.nrsc.gov.in/nrscnew/assets/pdf/announcements/EOS_04_writeup_modified.pdf"],
    notes: "NRSC handbook: centre frequency moved from RISAT-1's 5.35 GHz to 5.4 GHz. Swaths: FRS 25 km, MRS 160 km, CRS 223 km.",
    sats: [[51656, "EOS-4"]]
  },
  {
    id: "risat-2",
    name: "RISAT-2B / 2BR1 / 2BR2 (EOS-01)",
    operator: "ISRO",
    band: "X",
    centerFreqMHz: 9590,
    bandwidthMHz: null,
    polarizations: "HH, VV, HV or VH (single)",
    modes: "Super-Stripmap, Stripmap, ScanSAR, Spotlight",
    swathKm: 10,
    swathMode: "Stripmap",
    source: ["https://space.oscar.wmo.int/instruments/view/sar_x_risat_2"],
    notes: "WMO OSCAR SAR-X (RISAT-2 series): 9.59 GHz; Stripmap 10 km, ScanSAR 50 km. RISAT-2BR2 is EOS-01 on OSCAR. Bandwidth not stated.",
    sats: [[44233, "RISAT-2B"], [44857, "RISAT-2BR1"], [46905, "RISAT-2BR2"]]
  },
  {
    id: "gaofen-3",
    name: "Gaofen-3",
    operator: "CNSA (China)",
    band: "C",
    centerFreqMHz: 5400,
    bandwidthMHz: 240,
    bandwidthNote: "0–240 MHz (signal bandwidth, GF-3 01)",
    polarizations: "single, dual, full",
    modes: "12 imaging modes (Spotlight, Stripmap, ScanSAR, Wave, quad-pol …)",
    swathKm: null,
    swathMode: null,
    source: ["https://www.eoportal.org/satellite-missions/gaofen-3"],
    notes: "eoPortal: C-band 5.4 GHz, signal bandwidth 0–240 MHz. Parameters are for Gaofen-3 01; 02 and 03 are assumed to be the same design (not verified).",
    sats: [[41727, "GAOFEN-3"], [49495, "GAOFEN-3 02"], [52200, "GAOFEN-3 03"]]
  },
  {
    id: "lutan-1",
    name: "LuTan-1 (Ludi Tance-1, L-SAR)",
    operator: "China (Ministry of Natural Resources)",
    band: "L",
    centerFreqMHz: null,
    bandwidthMHz: 84,
    bandwidthNote: "up to 84 MHz",
    polarizations: "single, dual, quad, compact",
    modes: "Stripmap, ScanSAR (bistatic InSAR pair)",
    swathKm: null,
    swathMode: null,
    source: ["https://isprs-archives.copernicus.org/articles/XLVIII-1-W2-2023/1251/2023/isprs-archives-XLVIII-1-W2-2023-1251-2023.pdf"],
    notes: "L-band; bandwidth up to 84 MHz (ISPRS paper). Exact centre frequency not verified – frequency not verified.",
    sats: [[51284, "LUDI TANCE 1-01A (L-SAR 01A)"], [51822, "LUDI TANCE 1-01B (L-SAR 01B)"]]
  },
  {
    id: "hj-2ef",
    name: "HJ-2E / HJ-2F",
    operator: "CRESDA (China)",
    band: "S",
    centerFreqMHz: 2700,
    bandwidthMHz: null,
    approx: true,
    polarizations: null,
    modes: null,
    swathKm: null,
    swathMode: null,
    source: ["https://space.oscar.wmo.int/instruments/view/sar_s"],
    notes: "WMO OSCAR lists only 'S-band SAR, frequency ~ 2.7 GHz' – approximate; no bandwidth/polarization/swath given.",
    sats: [[54035, "HJ-2E"], [57519, "HJ-2F"]]
  },
  {
    id: "asnaro-2",
    name: "ASNARO-2",
    operator: "NEC / JEOSS (Japan)",
    band: "X",
    centerFreqMHz: 9650,
    bandwidthMHz: null,
    approx: true,
    polarizations: "HH or VV",
    modes: "Spotlight, Stripmap, ScanSAR",
    swathKm: 12,
    swathMode: "Stripmap (scene 12–52 km)",
    source: ["https://jeoss.co.jp/asnaro2/images/ASNARO-2-Product-Guide_icon_202110_EN.pdf"],
    notes: "Product guide: approximately 9.65 GHz. Stripmap swath 12–52 km, ScanSAR 50–183 km. Bandwidth not stated.",
    sats: [[43152, "ASNARO-2"]]
  },
  {
    id: "iceye",
    name: "ICEYE",
    operator: "ICEYE (Finland)",
    band: "X",
    centerFreqMHz: 9650,
    bandwidthMHz: 1200,
    bandwidthNote: "300 MHz (Gen-2), 600 MHz (Gen-3), 1200 MHz (Gen-3.5/4)",
    polarizations: "VV",
    modes: "Strip, Spot, Spot Fine, Dwell, Scan",
    swathKm: 30,
    swathMode: "Strip",
    match: "^ICEYE-X\\d+",
    source: ["https://iceye-ltd.github.io/product-documentation/6.0.2/productspecification/introduction/", "https://sar.iceye.com/6.0.8/productspecification/imagingmodes/"],
    notes: "Carrier 9.65 GHz for all generations (ICEYE product documentation). Strip swath 30 km, spotlight scenes 5×5 km. Satellites ≥ NORAD 100000 need Alpha-5 TLEs (handled).",
    sats: [[43800, "ICEYE-X2"], [44389, "ICEYE-X5"], [44390, "ICEYE-X4"], [46496, "ICEYE-X7"], [46497, "ICEYE-X6"], [56963, "ICEYE-X25"], [58288, "ICEYE-X31"], [58302, "ICEYE-X35"], [59100, "ICEYE-X38"], [59102, "ICEYE-X37"], [59103, "ICEYE-X36"], [60539, "ICEYE-X43"], [60546, "ICEYE-X39"], [60548, "ICEYE-X33"], [60549, "ICEYE-X40"], [62384, "ICEYE-X49"], [62389, "ICEYE-X47"], [62698, "ICEYE-X42"], [62700, "ICEYE-X41"], [62705, "ICEYE-X45"], [62707, "ICEYE-X44"], [63253, "ICEYE-X48"], [63255, "ICEYE-X50"], [63257, "ICEYE-X51"], [63258, "ICEYE-X46"], [64570, "ICEYE-X54"], [64572, "ICEYE-X52"], [64574, "ICEYE-X56"], [64578, "ICEYE-X57"], [64581, "ICEYE-X55"], [64584, "ICEYE-X53"], [66300, "ICEYE-X65"], [66301, "ICEYE-X66"], [66302, "ICEYE-X67"], [66751, "ICEYE-X58"], [66752, "ICEYE-X59"], [66753, "ICEYE-X60"], [66754, "ICEYE-X61"], [66755, "ICEYE-X62"], [67372, "ICEYE-X63"], [67373, "ICEYE-X64"], [68494, "ICEYE-X71"], [68496, "ICEYE-X73"], [68497, "ICEYE-X75"], [68500, "ICEYE-X74"], [68502, "ICEYE-X76"], [68504, "ICEYE-X72"], [68995, "ICEYE-X78"], [68996, "ICEYE-X82"], [69870, "ICEYE-X79"], [69889, "ICEYE-X81"], [69892, "ICEYE-X77"], [69893, "ICEYE-X80"], [100889, "ICEYE-X83"], [100894, "ICEYE-X87"], [100910, "ICEYE-X86"], [100914, "ICEYE-X85"]]
  },
  {
    id: "capella",
    name: "Capella (Acadia)",
    operator: "Capella Space (USA)",
    band: "X",
    centerFreqMHz: null,
    bandwidthMHz: 600,
    bandwidthNote: "up to 600 MHz",
    polarizations: "single: HH or VV",
    modes: "Spotlight, Sliding Spotlight, Stripmap",
    swathKm: null,
    swathMode: null,
    match: "^CAPELLA-\\d+",
    source: ["https://support.capellaspace.com/what-types-of-sensors-do-capellas-satellites-use", "https://www.capellaspace.com/solution/sensor-technology"],
    notes: "Operating band stated as 9.4–9.9 GHz (support page) / 9.3–9.9 GHz (sensor page); a single centre frequency is not stated in those sources – frequency not verified.",
    sats: [[57693, "CAPELLA-11 (ACADIA-1)"], [59444, "CAPELLA-14 (ACADIA-4)"], [60419, "CAPELLA-13 (ACADIA-3)"], [60544, "CAPELLA-15 (ACADIA-5)"], [64583, "CAPELLA-17 (ACADIA-7)"], [65318, "CAPELLA-16 (ACADIA-6)"], [67384, "CAPELLA-19 (ACADIA-9)"], [67385, "CAPELLA-18 (ACADIA-8)"], [68485, "CAPELLA-20 (ACADIA-10)"]]
  },
  {
    id: "umbra",
    name: "Umbra",
    operator: "Umbra (USA)",
    band: "X",
    centerFreqMHz: 9800,
    bandwidthMHz: 1200,
    polarizations: "HH or VV",
    modes: "Spotlight, extended dwell",
    swathKm: 5,
    swathMode: "Spotlight scene (5×5 km)",
    match: "^UMBRA-\\d+",
    source: ["https://www.eoportal.org/satellite-missions/umbra-sar"],
    notes: "Nominal centre frequency 9.8 GHz, bandwidth 1.2 GHz (eoPortal).",
    sats: [[58297, "UMBRA-07"], [60541, "UMBRA-09"], [60547, "UMBRA-10"], [66748, "UMBRA-11"], [67371, "UMBRA-12"]]
  },
  {
    id: "strix",
    name: "StriX (Synspective)",
    operator: "Synspective (Japan)",
    band: "X",
    centerFreqMHz: 9650,
    bandwidthMHz: 600,
    bandwidthNote: "chirp bandwidth up to 600 MHz",
    polarizations: "VV",
    modes: "Stripmap, Sliding Spotlight, Staring Spotlight",
    swathKm: 20,
    swathMode: "Stripmap (10–30 km)",
    match: "^STRIX-\\d+",
    source: ["https://synspective.com/satellite/satellite-strix/", "https://synspective.com/data/synspective-sar-data/"],
    notes: "Centre frequency 9.65 GHz; off-nadir 15–45°. Stripmap nominal swath 20 km, spotlight 10 km.",
    sats: [[53815, "STRIX-1"], [59224, "STRIX-3"], [60352, "STRIX-4"], [62406, "STRIX-2"], [65971, "STRIX-5"], [68291, "STRIX-6"], [69177, "STRIX-7"], [69701, "STRIX-8"], [100561, "STRIX-9"], [100746, "STRIX-10"], [100829, "STRIX-12"]]
  },
  {
    id: "qps-sar",
    name: "QPS-SAR (iQPS)",
    operator: "iQPS (Japan)",
    band: "X",
    centerFreqMHz: 9600,
    bandwidthMHz: 600,
    bandwidthNote: "approximately 600 MHz",
    polarizations: "HH or VV",
    modes: "Stripmap, Spotlight",
    swathKm: 14,
    swathMode: "Stripmap scene (14×7 km)",
    match: "^QPS-SAR-\\d+",
    source: ["https://i-qps.net/en/product/", "https://space.oscar.wmo.int/instruments/view/qps_sar"],
    notes: "Operator page: 9.6 GHz (X-band); WMO OSCAR lists 9.38 GHz – sources disagree; the operator value is shown.",
    sats: [[58578, "QPS-SAR-5 (TSUKUYOMI-I)"], [59447, "QPS-SAR-7 (TSUKUYOMI-II)"], [60542, "QPS-SAR-8 (AMATERU-IV)"], [63205, "QPS-SAR-9 (SUSANOO-I)"], [64055, "QPS-SAR-10 (WADATSUMI-I)"], [64340, "QPS-SAR-11 (YAMATSUMI-I)"], [65116, "QPS-SAR-12 (KUSHINADA-I)"], [66316, "QPS-SAR-14 (YACHIHOKO-I)"], [67228, "QPS-SAR-15 (SUKUNAMI-I)"], [100243, "QPS-SAR-13 (MIKURA-I)"], [100401, "QPS-SAR-18 (SUSANOO-II)"]]
  },
  {
    id: "kompsat-6",
    name: "KOMPSAT-6 (Arirang-6)",
    operator: "KARI (South Korea)",
    band: "X",
    centerFreqMHz: null,
    bandwidthMHz: null,
    polarizations: null,
    modes: null,
    swathKm: null,
    swathMode: null,
    source: ["https://celestrak.org/NORAD/elements/gp.php?NAME=KOMPSAT&FORMAT=json"],
    notes: "X-band SAR satellite; no KOMPSAT-6 in CelesTrak's catalogue at snapshot time (launch/status not verified). No public TLE.",
    sats: [],
    noPublicTle: [["KOMPSAT-6", null]]
  },
  {
    id: "tecsar",
    name: "TecSAR-1 / Ofek-series radar satellites",
    operator: "Israel (IAI / Ministry of Defense)",
    band: "X",
    centerFreqMHz: null,
    bandwidthMHz: null,
    polarizations: null,
    modes: null,
    swathKm: null,
    swathMode: null,
    source: ["https://celestrak.org/NORAD/elements/gp.php?NAME=TECSAR&FORMAT=json"],
    notes: "Military SAR satellites; not found in CelesTrak's public catalogue (query returned no data). No public TLE; radar parameters not verified.",
    sats: [],
    noPublicTle: [["TecSAR-1", null]]
  }
  ];
  var QUERIES = ["NAME=SENTINEL-1", "NAME=RADARSAT-2", "NAME=RCM", "NAME=TERRASAR-X", "NAME=TANDEM-X", "NAME=PAZ", "NAME=COSMO-SKYMED", "NAME=CSG", "NAME=SAOCOM", "NAME=ALOS-2", "NAME=ALOS-4", "NAME=ICEYE", "NAME=CAPELLA", "NAME=UMBRA", "NAME=STRIX", "NAME=QPS-SAR", "NAME=GAOFEN-3", "NAME=LUDI%20TANCE", "NAME=NOVASAR", "NAME=ARIRANG-5", "NAME=RISAT-2B", "NAME=NISAR", "NAME=BIOMASS", "NAME=HJ-2", "NAME=ASNARO-2", "CATNR=51656"];

  // frequency band limits (MHz) used for the band / frequency consistency check
  var BANDS = { P: [300, 1000], L: [1000, 2000], S: [2000, 4000], C: [4000, 8000], X: [8000, 12000] };
  function bandOf(mhz) { for (var b in BANDS) if (mhz >= BANDS[b][0] && mhz < BANDS[b][1]) return b; return null; }
  MISSIONS.forEach(function (m) { m.matchRe = m.match ? new RegExp(m.match) : null; });
  var BY_NORAD = {}, SATS = [];
  MISSIONS.forEach(function (m) { m.sats.forEach(function (s) { BY_NORAD[s[0]] = { mission: m, norad: s[0], name: s[1] }; SATS.push(BY_NORAD[s[0]]); }); });
  // Radar descriptor for a satellite (by NORAD id, or a name for satellites newer than the list), or null if it is not a known SAR satellite.
  function forSat(norad, name) {
    var e = BY_NORAD[norad];
    if (e) return e;
    if (name) for (var i = 0; i < MISSIONS.length; i++) if (MISSIONS[i].matchRe && MISSIONS[i].matchRe.test(String(name).toUpperCase())) return { mission: MISSIONS[i], norad: norad, name: name };
    return null;
  }
  function isSar(norad, name) { return !!forSat(norad, name); }
  function noPublicTle() { var out = []; MISSIONS.forEach(function (m) { (m.noPublicTle || []).forEach(function (n) { out.push({ name: n[0], mission: m }); }); }); return out; }

  /* ---------- export (1.3.1): one row per satellite, straight from the data above (works offline) ----------
     Columns: mission, operator, band, centerFreqMHz, bandwidthMHz, approx, polarizations, modes, swathKm, swathMode, secondaryBands, noradId, satName,
     satNote, notes, sources. A value that is null/unknown in the data stays BLANK (never guessed). A mission with no satellites listed gets one row
     with blank satellite columns; "no public TLE" satellites get a row with a blank noradId and satNote "no public TLE". */
  var EXPORT_COLUMNS = ["mission", "operator", "band", "centerFreqMHz", "bandwidthMHz", "approx", "polarizations", "modes", "swathKm", "swathMode", "secondaryBands", "noradId", "satName", "satNote", "notes", "sources"];
  function exportRows() {
    var out = [];
    MISSIONS.forEach(function (m) {
      function base() {
        return { mission: m.name, operator: m.operator == null ? null : m.operator, band: m.band == null ? null : m.band, centerFreqMHz: m.centerFreqMHz == null ? null : m.centerFreqMHz, bandwidthMHz: m.bandwidthMHz == null ? null : m.bandwidthMHz,
          approx: !!m.approx, polarizations: m.polarizations || null, modes: m.modes || null, swathKm: m.swathKm == null ? null : m.swathKm, swathMode: m.swathMode || null,
          secondaryBands: m.secondary && m.secondary.length ? JSON.parse(JSON.stringify(m.secondary)) : null, noradId: null, satName: null, satNote: null, notes: m.notes || null, sources: (m.source || []).slice() };
      }
      var sats = m.sats || [];
      sats.forEach(function (x) { var r = base(); r.noradId = x[0]; r.satName = x[1]; r.satNote = (m.satNotes && m.satNotes[String(x[0])]) || null; out.push(r); });
      if (!sats.length) out.push(base());
      (m.noPublicTle || []).forEach(function (x) { var r = base(); r.satName = x[0]; r.satNote = "no public TLE"; out.push(r); });
    });
    return out;
  }
  function cell(col, r) {
    var v = r[col]; if (v === null || v === undefined || v === "") return "";
    if (col === "approx") return v ? "yes" : "";
    if (col === "secondaryBands") return JSON.stringify(v);
    if (col === "sources") return v.join(" ");
    return String(v);
  }
  function quoteCell(t, delim) { return /["\r\n]/.test(t) || t.indexOf(delim) >= 0 ? '"' + t.replace(/"/g, '""') + '"' : t; }
  function toDelimited(rows, delim) {
    rows = rows || exportRows();
    return [EXPORT_COLUMNS.join(delim)].concat(rows.map(function (r) { return EXPORT_COLUMNS.map(function (c) { return quoteCell(cell(c, r), delim); }).join(delim); })).join("\n") + "\n";
  }
  function toCsv(rows) { return "\ufeff" + toDelimited(rows, ","); }     // UTF-8 BOM so Excel reads the en dashes / × correctly; LF line ends, RFC-4180 quoting
  function toTsv(rows) { return toDelimited(rows, "\t"); }               // for the clipboard (pastes into Sheets / Excel); same quoting, no BOM
  function toJson(rows) {
    rows = rows || exportRows();
    return JSON.stringify({ app: "SatPass", kind: "sar-list", columns: EXPORT_COLUMNS, note: "Nominal, informational radar parameters from data/sar.js; null = not verified (never guessed).", rows: rows }, null, 2) + "\n";
  }
  return { MISSIONS: MISSIONS, QUERIES: QUERIES, BANDS: BANDS, bandOf: bandOf, forSat: forSat, isSar: isSar, SATS: SATS, BY_NORAD: BY_NORAD, noPublicTle: noPublicTle, EXPORT_COLUMNS: EXPORT_COLUMNS, exportRows: exportRows, toCsv: toCsv, toTsv: toTsv, toJson: toJson };
});
