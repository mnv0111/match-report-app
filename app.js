const API = "https://sportscore.com/api/widget";
let sport = "football", timer = null, previous = new Map(), lastData = [];
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function pick(o, keys, fallback = "") { for (const k of keys) if (o && o[k] != null && o[k] !== "") return o[k]; return fallback; }
function unwrap(o) { return o?.match || o?.event || o?.data?.match || o?.data?.event || o?.data || o; }

function tennisSets(m) {
  const candidates = [m?.sets,m?.setScores,m?.set_scores,m?.periodScores,m?.period_scores,m?.periods,m?.scoresBySet,m?.scores_by_set,m?.scoreboard?.sets,m?.score?.sets,m?.scores?.sets,m?.result?.sets];
  let source=candidates.find(v=>Array.isArray(v)&&v.length);
  if (!source) { const x=m?.scores??m?.score; if(Array.isArray(x)&&x.length&&x.some(y=>typeof y==="object")) source=x; }
  if(!source) return [];
  const out=[];
  for(const x of source){
    let a=null,b=null;
    if(Array.isArray(x)){a=x[0];b=x[1];}
    else if(x&&typeof x==="object"){
      const n=x.score??x.scores??x.result;
      a=pick(x,["home","homeScore","home_score","team1","player1","participant1","p1"],null);
      b=pick(x,["away","awayScore","away_score","team2","player2","participant2","p2"],null);
      if((a==null||b==null)&&Array.isArray(n)){a=a??n[0];b=b??n[1];}
      if((a==null||b==null)&&n&&typeof n==="object"){a=a??pick(n,["home","homeScore","home_score","team1","player1"],null);b=b??pick(n,["away","awayScore","away_score","team2","player2"],null);}
    } else if(typeof x==="string"){const z=x.match(/(\d+)\s*[-:]\s*(\d+)/);if(z){a=z[1];b=z[2];}}
    if(a!=null&&b!=null&&Number.isFinite(Number(a))&&Number.isFinite(Number(b)))out.push({a:Number(a),b:Number(b),label:`${Number(a)}–${Number(b)}`});
  }
  return out;
}
function tennisMatchScore(m){
  if(sport!=="tennis")return score(m);
  const sets=m.setScores||[];
  if(sets.length)return `${sets.filter(s=>s.a>s.b).length} – ${sets.filter(s=>s.b>s.a).length}`;
  return score(m);
}
function tennisSetLine(m){
  const sets=m.setScores||[];
  return sets.length?sets.map((s,i)=>`<span class="set-chip"><small>Set ${i+1}</small><b>${esc(s.label)}</b></span>`).join(""):'<div class="set-missing">Set-by-set score not supplied by data source.</div>';
}

function normMatch(m) {
  m = unwrap(m) || {};
  let home = pick(m, ["homeTeam","home_team","home","team1","participant1","player1"], {});
  let away = pick(m, ["awayTeam","away_team","away","team2","participant2","player2"], {});
  if (typeof home === "object") home = pick(home, ["name","title","shortName"], "Home");
  if (typeof away === "object") away = pick(away, ["name","title","shortName"], "Away");
  let scoreObj = pick(m, ["score","scores","result"], {});
  let hs = pick(m, ["homeScore","home_score","scoreHome"], null), as = pick(m, ["awayScore","away_score","scoreAway"], null);
  if (typeof scoreObj === "object" && scoreObj) {
    hs = hs ?? pick(scoreObj, ["home","homeScore","home_score","team1"], null);
    as = as ?? pick(scoreObj, ["away","awayScore","away_score","team2"], null);
    if (hs == null && Array.isArray(scoreObj)) { hs = scoreObj[0]; as = scoreObj[1]; }
  } else if (typeof scoreObj === "string") {
    const z = scoreObj.match(/(\d+)\s*[-:]\s*(\d+)/); if (z) { hs = hs ?? z[1]; as = as ?? z[2]; }
  }
  const status = String(pick(m, ["status","state","matchStatus","status_text"], "unknown"));
  const slug = pick(m, ["slug","matchSlug","id","match_id"], `${home}-${away}`);
  let events = pick(m, ["timeline","events","incidents","matchEvents"], []); if (!Array.isArray(events)) events = [];
  return { raw:m, home, away, hs, as, setScores:tennisSets(m), status, slug, league:pick(m,["league","competition","tournament","country"],""), start:pick(m,["startTime","start_time","startTimestamp","date","kickoff","time"],""), duration:pick(m,["duration","matchDuration"],""), events, finished:/finish|ended|complete|closed|ft|after/i.test(status), live:/live|in.?play|playing|1st|2nd|set/i.test(status) };
}
function ist(v) {
  if (!v) return "Not provided";
  let d;
  if (typeof v === "number" || (typeof v === "string" && /^\d{10,13}$/.test(v))) { const n = Number(v); d = new Date(n < 1e12 ? n * 1000 : n); }
  else d = new Date(v);
  if (isNaN(d.getTime())) return String(v);
  return new Intl.DateTimeFormat("en-IN", {timeZone:"Asia/Kolkata",day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:true}).format(d) + " IST";
}
function score(m) { return m.hs != null && m.as != null ? `${m.hs} – ${m.as}` : "Score unavailable"; }
function labelStatus(m) { return m.finished ? "Finished" : m.live ? "In progress" : (m.raw?.status_text || m.status); }
async function getDetail(m) {
  if (!m.slug || String(m.slug).includes(" ")) return m;
  try {
    const u = `${API}/match/?sport=${encodeURIComponent(sport)}&slug=${encodeURIComponent(m.slug)}`;
    const r = await fetch(u); if (!r.ok) return m;
    const data = await r.json(); const detail = normMatch(data);
    // Prefer detailed response fields, but retain list data when details omit a field.
    return {...m, ...detail, home:detail.home && detail.home !== "Home" ? detail.home : m.home, away:detail.away && detail.away !== "Away" ? detail.away : m.away, hs:detail.hs ?? m.hs, as:detail.as ?? m.as, start:detail.start || m.start, league:detail.league || m.league, events:detail.events.length ? detail.events : m.events, setScores:detail.setScores?.length ? detail.setScores : m.setScores, raw:{...m.raw,...detail.raw}};
  } catch (_) { return m; }
}
async function load(silent = false) {
  const status = $("status"); if (!silent) status.textContent = "Loading " + sport + " matches…";
  try {
    const r = await fetch(`${API}/matches/?sport=${sport}&limit=${$("limit").value}`);
    if (!r.ok) throw new Error("Sports data returned HTTP " + r.status);
    const data = await r.json();
    const list = Array.isArray(data) ? data : (data.matches || data.events || data.data || []);
    lastData = list.map(normMatch);
    if (!lastData.length) { status.textContent = "No matches were returned for this sport right now."; render(); return; }
    status.textContent = `${lastData.length} matches loaded · checked ${new Date().toLocaleTimeString()}`;
    for (const m of lastData) {
      const key = sport + ":" + m.slug, old = previous.get(key);
      if (old && !old.finished && m.finished) notifyFinished(m);
      previous.set(key, {finished:m.finished});
    }
    render();
  } catch (e) {
    status.innerHTML = `Could not load sports data: ${esc(e.message)}. Check internet and try Refresh. <br>Data source: <a href="https://sportscore.com/developers/" target="_blank" rel="dofollow">SportScore API</a>.`;
    if (!silent) $("matches").innerHTML = '<div class="empty">The app can still be installed, but match data needs a working data endpoint. Exact goal/set timestamps are not guaranteed by the provider.</div>';
  }
}
function render() {
  const root = $("matches");
  if (!lastData.length) { root.innerHTML = '<div class="empty">No matches to show. Tap Refresh to try again.</div>'; return; }
  root.innerHTML = lastData.map((m,i) => `<article class="card"><div class="card-main"><div class="league">${esc(typeof m.league === "object" ? pick(m.league,["name","title"],"") : m.league || sport.toUpperCase())}</div><div class="teams">${esc(m.home)}<br>${esc(m.away)}</div><div class="meta">${esc(labelStatus(m))} · Start: ${esc(ist(m.start))}</div><button data-report="${i}">Open post-match report →</button></div><div class="score">${esc(tennisMatchScore(m))}${sport === "tennis" ? `<div class="set-line">${tennisSetLine(m)}</div>` : ""}</div><div class="badge">${m.finished ? "Final" : m.live ? "Live" : "Match"}</div></article>`).join("");
  root.querySelectorAll("[data-report]").forEach(b => b.onclick = () => openReport(lastData[+b.dataset.report]));
}
function eventTime(e) { return ist(pick(e,["timestamp","time","date","createdAt","eventTime","startTime","start_timestamp"],"")); }
function eventText(e) {
  const type = pick(e,["type","eventType","incidentType","kind"],"Event");
  const text = pick(e,["text","description","detail","name","comment","info"],"");
  let player = pick(e,["player","scorer","playerName","player_name"],""); if (typeof player === "object") player = pick(player,["name"],"");
  const minute = pick(e,["minute","matchMinute","timeLabel","extra_minute"],"");
  return `${type}${minute ? ` (${minute}${e.extra_minute ? `+${e.extra_minute}` : ""}′)` : ""}${player ? ` — ${player}` : ""}${text ? `: ${text}` : ""}`;
}
async function openReport(match) {
  const title = $("detailTitle"), body = $("detailBody");
  title.textContent = `${match.home} vs ${match.away}`;
  body.innerHTML = '<div class="empty">Loading detailed match report…</div>';
  $("detail").showModal();
  const m = await getDetail(match);
  const events = m.events.map(e => `<div class="event"><div class="event-time">${esc(eventTime(e))}</div><div class="event-text">${esc(eventText(e))}</div></div>`).join("");
  const finish = pick(m.raw,["finishTime","finish_time","endTime","end_time","finishedAt","finished_at"],"");
  body.innerHTML = `<div class="report-grid"><div class="report-box"><small>Final score / result</small><strong>${esc(tennisMatchScore(m))}</strong>${sport === "tennis" ? `<div class="report-sets">${tennisSetLine(m)}</div>` : ""}</div><div class="report-box"><small>Status</small><strong>${esc(labelStatus(m))}</strong></div><div class="report-box"><small>Start time</small><strong>${esc(ist(m.start))}</strong></div><div class="report-box"><small>Finish time</small><strong>${esc(finish ? ist(finish) : "Not supplied by source")}</strong></div></div><h3>${sport === "football" ? "Goal / match timeline" : "Set / match timeline"}</h3>${sport === "tennis" && m.setScores?.length ? `<h4>Set scores</h4><div class="set-line">${tennisSetLine(m)}</div>` : ""}${events || '<div class="empty">The detail endpoint did not return a timeline for this match. The final result is shown where available; exact goal or set-completion clock times cannot be inferred safely.</div>'}<p class="hint">Times are displayed in IST only when the provider supplies a timestamp. A match minute (e.g. 67′) is not the same as real-world clock time.</p>`;
}
function notifyFinished(m) { if (!("Notification" in window) || Notification.permission !== "granted") return; new Notification(`${sport === "football" ? "⚽" : "🎾"} Match finished`, {body:`${m.home} ${score(m)} ${m.away}. Open Match Report for details.`,icon:"./icon.svg",tag:sport+":"+m.slug}); }
$("refresh").onclick = () => load(); $("limit").onchange = () => load();
document.querySelectorAll(".tab").forEach(b => b.onclick = () => { sport = b.dataset.sport; document.querySelectorAll(".tab").forEach(x => x.classList.toggle("active",x === b)); previous.clear(); load(); });
$("poll").onchange = () => { if (timer) clearInterval(timer); timer = null; if (+$("poll").value) timer = setInterval(() => load(true), +$("poll").value * 60000); };
$("enableNotify").onclick = async () => { if (!("Notification" in window)) { $("notifyStatus").textContent = "This browser does not support notifications."; return; } const p = await Notification.requestPermission(); $("notifyStatus").textContent = p === "granted" ? "Notifications enabled. Keep the app open for finish detection in this version." : "Notifications were not allowed. Enable them in browser/site settings."; };
$("testTone").onclick = () => { try { const ctx = new (window.AudioContext || window.webkitAudioContext)(); const o = ctx.createOscillator(), g = ctx.createGain(); o.connect(g); g.connect(ctx.destination); o.frequency.value = 880; g.gain.value = .12; o.start(); setTimeout(() => { o.stop(); ctx.close(); }, 220); } catch (_) { alert("Sound not available in this browser."); } };
$("closeDetail").onclick = () => $("detail").close();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("./service-worker.js").catch(() => {});
load();
