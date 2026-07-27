// These constants connect JavaScript to matching HTML ids in index.html.
const form = document.querySelector("#song-search-form");
const input = document.querySelector("#song-search-input");
const searchButton = document.querySelector("#search-button");
const results = document.querySelector("#song-results");
const albumCover = document.querySelector("#album-cover");
const songInfo = document.querySelector("#song-info");
const songLinks = document.querySelector("#song-links");
const lyricsOutput = document.querySelector("#lyrics-output");
const fullLyricsLink = document.querySelector("#full-lyrics-link");
const SEARCH_COOLDOWN_MS = 3000;
let lastSearchTime = 0;
let searchInProgress = false;

form.addEventListener("submit", function (event) {
  event.preventDefault();

  const songName = input.value.trim();

  if (songName) {
    const waitTime = getSearchWaitTime();

    if (searchInProgress) {
      showMessage("Please wait for the current search to finish.");
      return;
    }

    if (waitTime > 0) {
      showMessage(
        `Please wait ${Math.ceil(waitTime / 1000)} more second(s) before searching again.`,
      );
      return;
    }

    searchSong(songName);
  } else {
    hideResults();
  }
});

async function searchSong(songName) {
  searchInProgress = true;
  lastSearchTime = Date.now();
  setSearchButtonLoading(true);
  showMessage("Searching...");

  try {
    const track = await findSong(songName);

    if (!track) {
      showMessage("Song not found. Try another title.");
      return;
    }

    renderSong(track);
  } catch (error) {
    showMessage(error.message);
  } finally {
    searchInProgress = false;
    setSearchButtonLoading(false);
  }
}

async function findSong(songName) {
  const response = await fetch(`/api/search?q=${encodeURIComponent(songName)}`);

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    throw new Error(errorData?.error || "Song search failed.");
  }

  const data = await response.json();
  return data.track;
}

function renderSong(track) {
  const album = track.album;
  const mainArtist = track.artists[0];
  const spotifyUrl = track.external_urls.spotify;
  const imageUrl = album.images[0]?.url;

  showResults();
  clearResults();

  if (imageUrl) {
    albumCover.innerHTML = `<img src="${imageUrl}" alt="${escapeHTML(album.name)} album cover">`;
  }

  const featuredArtists = track.artists.slice(1);
  const featuredHTML = featuredArtists.length
    ? featuredArtists
        .map((artist) =>
          artist.external_urls?.spotify
            ? `<a class="meta-link" href="${artist.external_urls.spotify}" target="_blank" rel="noreferrer">${escapeHTML(artist.name)}</a>`
            : escapeHTML(artist.name),
        )
        .join(", ")
    : "None";

  songInfo.innerHTML = `
    <h2>${escapeHTML(track.name)}</h2>
    <p class="artist">${escapeHTML(mainArtist.name)}</p>

    <dl class="song-meta">
      <div>
        <dt>Album</dt>
        <dd>
          <span>${escapeHTML(album.name)}</span>
          <a class="meta-link" href="${spotifyUrl}" target="_blank" rel="noreferrer">View on Spotify</a>
        </dd>
      </div>
      <div>
        <dt>Released</dt>
        <dd>${album.release_date}</dd>
      </div>
      <div>
        <dt>Duration</dt>
        <dd>${formatTime(track.duration_ms)}</dd>
      </div>
      <div>
        <dt>Features</dt>
        <dd>${featuredHTML}</dd>
      </div>
    </dl>
  `;

  // Spotify and YouTube buttons
  const youtubeUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(`${track.name} ${mainArtist.name}`)}`;
  songLinks.innerHTML = `
    <a class="spotify-link" href="${spotifyUrl}" target="_blank" rel="noreferrer">Spotify</a>
    <a class="youtube-link" href="${youtubeUrl}" target="_blank" rel="noreferrer">YouTube</a>
  `;

  renderLyrics(track.name, mainArtist.name);

  // The Full Lyrics link opens a Genius search for the song.
  fullLyricsLink.href = `https://genius.com/search?q=${encodeURIComponent(`${track.name} ${mainArtist.name}`)}`;
  fullLyricsLink.target = "_blank";
  fullLyricsLink.rel = "noreferrer";
}

async function renderLyrics(songName, artistName) {
  lyricsOutput.innerHTML = `
    <div class="loading-message">
      <span class="loading-spinner"></span>
      <p class="status-message">Loading lyrics...</p>
    </div>
  `;

  try {
    const url = `https://lrclib.net/api/get?track_name=${encodeURIComponent(songName)}&artist_name=${encodeURIComponent(artistName)}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error("Lyrics not found.");
    }

    const data = await response.json();
    const lyrics = data.plainLyrics;

    lyricsOutput.innerHTML = lyrics
      ? lyrics
          .split("\n")
          .map((line) => `<p>${escapeHTML(line)}</p>`)
          .join("")
      : `<p class="status-message">Lyrics unavailable.</p>`;
  } catch {
    lyricsOutput.innerHTML = `<p class="status-message">Could not load lyrics.</p>`;
  }
}

function showResults() {
  document.body.classList.add("results-visible");
  results.classList.remove("hidden");
}

function hideResults() {
  document.body.classList.remove("results-visible");
  results.classList.add("hidden");
}

function clearResults() {
  albumCover.innerHTML = "";
  songInfo.innerHTML = "";
  songLinks.innerHTML = "";
  lyricsOutput.innerHTML = "";
  fullLyricsLink.href = "#";
}

function showMessage(message) {
  showResults();
  clearResults();
  songInfo.innerHTML = `<p class="status-message">${escapeHTML(message)}</p>`;
}

function getSearchWaitTime() {
  const timeSinceLastSearch = Date.now() - lastSearchTime;
  return Math.max(SEARCH_COOLDOWN_MS - timeSinceLastSearch, 0);
}

function setSearchButtonLoading(isLoading) {
  searchButton.disabled = isLoading;
  searchButton.textContent = isLoading ? "Searching..." : "Search";
}

function formatTime(ms) {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function escapeHTML(value) {
  const replacements = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  };

  return String(value).replace(
    /[&<>"']/g,
    (character) => replacements[character],
  );
}
