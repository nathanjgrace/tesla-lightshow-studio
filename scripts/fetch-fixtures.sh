#!/usr/bin/env bash
# Downloads Tesla's official example light shows into ./fixtures so the
# round-trip tests can run against real files. The files belong to Tesla and
# are not committed to this repo.
set -euo pipefail
cd "$(dirname "$0")/.."
REV=9f949512146d881b6eb66d042b22ee3f9e115afb
BASE="https://raw.githubusercontent.com/teslamotors/light-show/$REV/examples"
mkdir -p fixtures
fetch() {
  local src="$1" dest="fixtures/$2"
  [ -f "$dest" ] && { echo "have $dest"; return; }
  echo "fetching $dest"
  curl -sSfL "$BASE/$src" -o "$dest"
}
fetch "lightshow_example_3_The_Arrival_5_Car/Car%20%231/LightShow/lightshow.fseq" arrival-car1.fseq
fetch "lightshow_example_5_Cyber_Symphony_4_Car/Car%20%231/LightShow/lightshow.fseq" cyber-symphony-car1.fseq
fetch "lightshow_example_4_Ready_for_Assault_8_Car/Car%20%231/LightShow/lightshow.fseq" ready-for-assault-car1.fseq
# Tesla's xLights layout: where each channel sits on its 3D Model S and Cybertruck.
if [ ! -f fixtures/xlights_rgbeffects.xml ]; then
  echo "fetching fixtures/xlights_rgbeffects.xml"
  tmp="$(mktemp)"
  curl -sSfL "https://raw.githubusercontent.com/teslamotors/light-show/$REV/xlights/tesla_xlights_show_folder.zip" -o "$tmp"
  unzip -p "$tmp" tesla_xlights_show_folder/xlights_rgbeffects.xml > fixtures/xlights_rgbeffects.xml
  rm -f "$tmp"
else
  echo "have fixtures/xlights_rgbeffects.xml"
fi
echo "done"
