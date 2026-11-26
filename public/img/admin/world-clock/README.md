# World clock imagery

The clock reads day and night imagery from the local app.

- `earth-day-8k.png` is the original [8192 × 4096 NASA Blue Marble image](https://eoimages.gsfc.nasa.gov/images/imagerecords/57000/57730/land_ocean_ice_8192.png). The installed app obtains this image through its shared resource cache.
- `earth-day.jpg` is the bundled [2048 × 1024 version](https://eoimages.gsfc.nasa.gov/images/imagerecords/57000/57730/land_ocean_ice_2048.jpg). The globe uses it when the GPU's maximum texture size is below 8192 or when the 8K image fails to load or decode. Both day maps use mipmaps for stable detail when zoomed out.
- `earth-night.jpg`: NASA Earth Observatory, [Earth's city lights](https://eoimages.gsfc.nasa.gov/images/imagerecords/55000/55167/earth_lights_lrg.jpg).

NASA imagery is used for geographic illustration. City lights are a historical composite, not live observations. The approximate day/night boundary uses the [NOAA solar equations](https://gml.noaa.gov/grad/solcalc/solareqns.PDF); clock times use the runtime's IANA time-zone data independently.
