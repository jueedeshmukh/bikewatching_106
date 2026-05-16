import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
console.log('Mapbox GL JS Loaded:', mapboxgl);

// Set your Mapbox access token here
mapboxgl.accessToken = 'pk.eyJ1IjoianVlZWRlc2htdWtoIiwiYSI6ImNtcDd2ZXh0OTA2YnQycG82bDVuZDN6ZnIifQ.1Wx44niRtIUIdw6GYUaQWA';

// Initialize the map
const map = new mapboxgl.Map({
  container: 'map', // ID of the div where the map will render
  style: 'mapbox://styles/mapbox/dark-v11', // Map style
  center: [-71.09415, 42.36027], // [longitude, latitude]
  zoom: 12, // Initial zoom level
  minZoom: 5, // Minimum allowed zoom
  maxZoom: 18, // Maximum allowed zoom
});

const glowStyle = { 'line-width': 12, 'line-opacity': 0.15, 'line-blur': 6 };
const coreStyle = { 'line-width': 2, 'line-opacity': 0.9 };

const svg = d3.select('#map').select('svg');

let timeFilter = -1;

let departuresByMinute = Array.from({ length: 1440 }, () => []);
let arrivalsByMinute = Array.from({ length: 1440 }, () => []);

function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes);
  return date.toLocaleString('en-US', { timeStyle: 'short' });
}

function computeStationTraffic(stations, timeFilter = -1) {
  const departures = d3.rollup(
    filterByMinute(departuresByMinute, timeFilter),
    (v) => v.length,
    (d) => d.start_station_id,
  );

  const arrivals = d3.rollup(
    filterByMinute(arrivalsByMinute, timeFilter),
    (v) => v.length,
    (d) => d.end_station_id,
  );

  return stations.map((station) => {
    let id = station.short_name;
    station.arrivals = arrivals.get(id) ?? 0;
    station.departures = departures.get(id) ?? 0;
    station.totalTraffic = station.arrivals + station.departures;
    return station;
  });
}

function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function filterByMinute(tripsByMinute, minute) {
  if (minute === -1) {
    return tripsByMinute.flat();
  }

  let minMinute = (minute - 60 + 1440) % 1440;
  let maxMinute = (minute + 60) % 1440;

  if (minMinute > maxMinute) {
    let beforeMidnight = tripsByMinute.slice(minMinute);
    let afterMidnight = tripsByMinute.slice(0, maxMinute);
    return beforeMidnight.concat(afterMidnight).flat();
  } else {
    return tripsByMinute.slice(minMinute, maxMinute).flat();
  }
}

function getCoords(station) {
  const point = new mapboxgl.LngLat(+station.lon, +station.lat);
  const { x, y } = map.project(point);
  return { cx: x, cy: y };
}

map.on('load', async () => {
  map.addSource('boston_route', {
    type: 'geojson',
    data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson',
  });

  map.addSource('cambridge_route', {
    type: 'geojson',
    data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson',
  });

  // Outer glow layer
  map.addLayer({
    id: 'bike-lanes-glow',
    type: 'line',
    source: 'boston_route',
    paint: { ...glowStyle, 'line-color': '#00ff99' },
  });

  // Core bright layer
  map.addLayer({
    id: 'bike-lanes',
    type: 'line',
    source: 'boston_route',
    paint: { ...coreStyle, 'line-color': '#00ff99' },
  });

  // Cambridge glow layer
  map.addLayer({
    id: 'cambridge-bike-lanes-glow',
    type: 'line',
    source: 'cambridge_route',
    paint: { ...glowStyle, 'line-color': '#00aaff' },
  });

  // Cambridge core layer
  map.addLayer({
    id: 'cambridge-bike-lanes',
    type: 'line',
    source: 'cambridge_route',
    paint: { ...coreStyle, 'line-color': '#00aaff' },
  });

  let stations = [];
  try {
    const jsonurl = 'https://gbfs.bluebikes.com/gbfs/en/station_information.json';
    const jsonData = await d3.json(jsonurl);
    stations = jsonData.data.stations;
  } catch (error) {
    console.error('Error loading JSON:', error);
  }

  const trips = await d3.csv(
    'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv',
    (trip) => {
      trip.started_at = new Date(trip.started_at);
      trip.ended_at = new Date(trip.ended_at);
      departuresByMinute[minutesSinceMidnight(trip.started_at)].push(trip);
      arrivalsByMinute[minutesSinceMidnight(trip.ended_at)].push(trip);
      return trip;
    },
  );

  stations = computeStationTraffic(stations);
  console.log('Stations with traffic:', stations);

  const radiusScale = d3
    .scaleSqrt()
    .domain([0, d3.max(stations, (d) => d.totalTraffic)])
    .range([0, 25]);

  const stationFlow = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]);

  const circles = svg
    .selectAll('circle')
    .data(stations, (d) => d.short_name)
    .enter()
    .append('circle')
    .attr('r', (d) => radiusScale(d.totalTraffic))
    .style('--departure-ratio', (d) => stationFlow(d.departures / d.totalTraffic))
    .each(function (d) {
      d3.select(this)
        .append('title')
        .text(
          `${d.name}\n${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`,
        );
    });

  function updatePositions() {
    circles
      .attr('cx', (d) => getCoords(d).cx)
      .attr('cy', (d) => getCoords(d).cy);
  }

  updatePositions();

  map.on('move', updatePositions);
  map.on('zoom', updatePositions);
  map.on('resize', updatePositions);
  map.on('moveend', updatePositions);

  const timeSlider = document.getElementById('time-slider');
  const selectedTime = document.getElementById('time-display');
  const anyTimeLabel = document.getElementById('any-time');

  function updateScatterPlot(timeFilter) {
    const filteredStations = computeStationTraffic(stations, timeFilter);
    timeFilter === -1 ? radiusScale.range([0, 25]) : radiusScale.range([3, 50]);
    circles
      .data(filteredStations, (d) => d.short_name)
      .join('circle')
      .attr('r', (d) => radiusScale(d.totalTraffic))
      .style('--departure-ratio', (d) =>
        stationFlow(d.departures / d.totalTraffic),
      );
  }

  function updateTimeDisplay() {
    let timeFilter = Number(timeSlider.value);

    if (timeFilter === -1) {
      selectedTime.textContent = '';
      anyTimeLabel.style.display = 'block';
    } else {
      selectedTime.textContent = formatTime(timeFilter);
      anyTimeLabel.style.display = 'none';
    }

    updateScatterPlot(timeFilter);
  }

  timeSlider.addEventListener('input', updateTimeDisplay);
  updateTimeDisplay();
});
