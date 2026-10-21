# World clock imagery

Bundled locally so the clock does not request an external map service.

- `earth-day-8k.png`: NASA Visible Earth / Blue Marble, [8192 × 4096 land, ocean and ice image](https://eoimages.gsfc.nasa.gov/images/imagerecords/57000/57730/land_ocean_ice_8192.png), bundled without resizing or recompression.
- `earth-day.jpg`: [2048 × 1024 version](https://eoimages.gsfc.nasa.gov/images/imagerecords/57000/57730/land_ocean_ice_2048.jpg) of the same NASA imagery, used when the GPU's maximum texture size is below 8192. Both day maps use mipmaps for stable detail when zoomed out.
- `earth-night.jpg`: NASA Earth Observatory, [Earth's city lights](https://eoimages.gsfc.nasa.gov/images/imagerecords/55000/55167/earth_lights_lrg.jpg).

NASA imagery is used for geographic illustration. City lights are a historical composite, not live observations. The approximate day/night boundary uses the [NOAA solar equations](https://gml.noaa.gov/grad/solcalc/solareqns.PDF); clock times use the runtime's IANA time-zone data independently.
