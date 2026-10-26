const API = "https://sportscore.com/api/widget";
let sport = "football", timer = null, accessTimer = null, previous = new Map(), lastData = [];
let supabaseClient = null, currentUser = null, currentProfile = null, otpEmail = "", matchAppStarted = false, currentGate = "auth";
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function pick(o, keys, fallback = "") { for (const k of keys) if (o && o[k] != null && o[k] !== "") return o[k]; return fallback; }
function unwrap(o) { return o?.match || o?.event || o?.data?.match || o?.data?.event || o?.data || o; }

/* ---------------- Authentication and approval gate ---------------- */
function authMessage(text, type = "info") {
  const el = $("authMessage"); if (!el) return;
  el.textContent = text || ""; el.className = "notice" + (type === "error" ? " error" : type === "success" ? " success" : type === "warning" ? " warning" : "");
  el.hidden = !text;
}
function approvalMessage(text, type = "info") {
  const el = $("approvalMessage"); if (!el) return;
  el.textContent = text || ""; el.className = "notice" + (type === "error" ? " error" : type === "success" ? " success" : type === "warning" ? " warning" : "");
  el.hidden = !text;
}
function adminMessage(text, type = "info") {
  const el = $("adminMessage"); if (!el) return;
  el.textContent = text || ""; el.className = "notice" + (type === "error" ? " error" : type === "success" ? " success" : type === "warning" ? " warning" : "");
  el.hidden = !text;
}
function setGate(gate) {
  currentGate = gate;
  $("authGate").hidden = gate !== "auth";
  $("approvalGate").hidden = gate !== "approval";
  $("appMain").hidden = gate !== "app";
  $("refresh").hidden = gate !== "app";
  $("signOut").hidden = gate === "auth";
  $("sessionLabel").hidden = gate !== "app";
  if (gate !== "app") stopMatchPolling();
}
function setAuthMode(mode) {
  $("loginForm").hidden = mode !== "login";
  $("signupForm").hidden = mode !== "signup";
  $("otpForm").hidden = mode !== "otp";
  $("authTabs").hidden = mode === "otp";
  document.querySelectorAll("[data-auth-mode]").forEach(b => b.classList.toggle("active", b.dataset.authMode === mode));
  authMessage("");
  if (mode === "login") $("loginEmail").focus();
  if (mode === "signup") $("signupFullName").focus();
  if (mode === "otp") $("otpToken").focus();
}
function stopMatchPolling() {
  if (timer) clearInterval(timer);
  timer = null;
  if (accessTimer) clearInterval(accessTimer);
  accessTimer = null;
  matchAppStarted = false;
}
function busyForm(form, busy) {
  if (!form) return;
  form.querySelectorAll("button[type='submit']").forEach(b => { b.disabled = busy; b.dataset.oldText = b.dataset.oldText || b.textContent; b.textContent = busy ? "Please wait…" : b.dataset.oldText; });
}
function userLabel(profile, user) { return profile?.full_name?.trim() || user?.email || "Signed in"; }
function showStatusGate(profile) {
  const status = String(profile?.approval_status || "pending").toLowerCase();
  $("approvalIcon").textContent = status === "approved" ? "✓" : status === "blocked" || status === "rejected" ? "!" : "◷";
  $("approvalTitle").textContent = status === "pending" ? "Approval pending" : status === "blocked" ? "Account blocked" : status === "rejected" ? "Access not approved" : "Account access unavailable";
  $("approvalText").textContent = status === "pending"
    ? "Your email is verified. An administrator must approve your account before you can view reports. This page will not unlock until your profile is approved."
    : status === "blocked"
      ? "An administrator has blocked this account. Match reports are unavailable. Contact the administrator if you think this is a mistake."
      : status === "rejected"
        ? "An administrator did not approve this account. Match reports are unavailable. Contact the administrator if you think this is a mistake."
        : "This account is not approved to view reports. Contact the administrator.";
  approvalMessage("");
  setGate("approval");
}
async function routeSignedIn(userOverride = null) {
  if (!supabaseClient) return;
  let user = userOverride;
  if (!user) {
    const { data, error } = await supabaseClient.auth.getUser();
    if (error) { setGate("auth"); authMessage(error.message, "error"); return; }
    user = data?.user;
  }
  if (!user) { currentUser = null; currentProfile = null; showSignedOut(); return; }
  const { data: profile, error: profileError } = await supabaseClient
    .from("profiles")
    .select("id, full_name, email, role, approval_status, created_at")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError) {
    setGate("auth");
    authMessage("Signed in, but the profile could not be loaded. Check that public.profiles is exposed in Data API and that the SELECT grants/RLS policies are saved. Details: " + profileError.message, "error");
    return;
  }
  if (!profile) {
    setGate("auth");
    authMessage("Your authentication account exists, but no matching profiles row was found. The signup trigger may not have created it. Do not create a profile manually with elevated privileges; check the trigger first.", "error");
    return;
  }
  currentUser = user; currentProfile = profile;
  if (String(profile.approval_status).toLowerCase() !== "approved") { showStatusGate(profile); return; }
  if (profile.role !== "admin" && profile.role !== "user") {
    showStatusGate({approval_status:"blocked"}); return;
  }
  setGate("app");
  $("sessionLabel").textContent = userLabel(profile, user);
  $("adminPanel").hidden = !(profile.role === "admin" && profile.approval_status === "approved");
  if (!matchAppStarted) startMatchApp();
  if (!$("adminPanel").hidden) await loadAdminUsers();
  else { $("adminUsers").innerHTML = ""; adminMessage(""); }
  if (!accessTimer) accessTimer = setInterval(checkCurrentAccess, 60000);
}
function showSignedOut() {
  currentUser = null; currentProfile = null; otpEmail = "";
  stopMatchPolling();
  setGate("auth"); setAuthMode("login"); authMessage(""); approvalMessage("");
  $("loginPassword").value = ""; $("signupPassword").value = ""; $("signupPassword2").value = ""; $("otpToken").value = "";
  $("sessionLabel").textContent = "";
}
async function signOut() {
  if (supabaseClient) {
    const { error } = await supabaseClient.auth.signOut();
    if (error) authMessage("Sign out warning: " + error.message, "warning");
  }
  showSignedOut();
}
async function checkCurrentAccess() {
  if (!supabaseClient || !currentUser) return;
  const { data, error } = await supabaseClient.from("profiles").select("id,full_name,email,role,approval_status,created_at").eq("id", currentUser.id).maybeSingle();
  if (error || !data) return;
  const oldRole = currentProfile?.role;
  currentProfile = data;
  if (data.approval_status !== "approved" || !["admin", "user"].includes(data.role)) {
    showStatusGate(data);
  } else if (oldRole !== data.role) {
    await routeSignedIn(currentUser);
  }
}

$("authTabs").querySelectorAll("[data-auth-mode]").forEach(b => b.addEventListener("click", () => setAuthMode(b.dataset.authMode)));
$("backToLogin").addEventListener("click", () => setAuthMode("login"));
$("signOut").addEventListener("click", signOut);
$("signOutPending").addEventListener("click", signOut);
$("checkApproval").addEventListener("click", async () => {
  approvalMessage("Checking account status…");
  await routeSignedIn();
  if (currentGate === "approval") approvalMessage("Status checked. If it still says pending, the admin has not approved the account yet.");
});
$("loginForm").addEventListener("submit", async e => {
  e.preventDefault(); const form = e.currentTarget; authMessage("");
  if (!supabaseClient) { authMessage("Supabase is not configured yet. Add the project's public/publishable key in config.js first.", "error"); return; }
  const email = $("loginEmail").value.trim().toLowerCase();
  const password = $("loginPassword").value;
  busyForm(form, true);
  try {
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) { authMessage(error.message, "error"); return; }
    await routeSignedIn(data?.user || null);
  } catch (err) { authMessage(err.message || "Sign-in failed.", "error"); }
  finally { busyForm(form, false); }
});
$("signupForm").addEventListener("submit", async e => {
  e.preventDefault(); const form = e.currentTarget; authMessage("");
  if (!supabaseClient) { authMessage("Supabase is not configured yet. Add the project's public/publishable key in config.js first.", "error"); return; }
  const fullName = $("signupFullName").value.trim();
  const email = $("signupEmail").value.trim().toLowerCase();
  const password = $("signupPassword").value;
  const confirm = $("signupPassword2").value;
  if (!fullName) { authMessage("Enter your full name.", "error"); return; }
  if (password.length < 8) { authMessage("Use a password with at least 8 characters.", "error"); return; }
  if (password !== confirm) { authMessage("The passwords do not match.", "error"); return; }
  busyForm(form, true);
  try {
    const { data, error } = await supabaseClient.auth.signUp({ email, password, options: { data: { full_name: fullName } } });
    if (error) { authMessage(error.message, "error"); return; }
    otpEmail = email;
    $("otpEmailLabel").textContent = email;
    $("otpToken").value = "";
    if (data?.session?.user) {
      authMessage("Account created. Checking verification and approval status…", "success");
      await routeSignedIn(data.session.user);
    } else {
      setAuthMode("otp");
      authMessage("Verification email requested. Enter the code from your email. If the email contains a link instead of a code, the Supabase Confirm signup email template must be switched to {{ .Token }}.", "warning");
    }
  } catch (err) { authMessage(err.message || "Could not create the account.", "error"); }
  finally { busyForm(form, false); }
});
$("otpForm").addEventListener("submit", async e => {
  e.preventDefault(); const form = e.currentTarget; authMessage("");
  if (!supabaseClient) { authMessage("Supabase is not configured yet. Add the project's public/publishable key in config.js first.", "error"); return; }
  const email = otpEmail || $("signupEmail").value.trim().toLowerCase();
  const token = $("otpToken").value.trim().replace(/\s/g, "");
  if (!email) { authMessage("Enter the email used to create the account.", "error"); return; }
  if (!/^\d{6,8}$/.test(token)) { authMessage("Enter the numeric verification code from the email.", "error"); return; }
  busyForm(form, true);
  try {
    const { data, error } = await supabaseClient.auth.verifyOtp({ email, token, type: "email" });
    if (error) { authMessage(error.message, "error"); return; }
    if (data?.user || data?.session?.user) {
      authMessage("Email verified. Checking admin approval…", "success");
      await routeSignedIn(data.user || data.session.user);
    } else { authMessage("Email verification did not return a user session. Try signing in after verification.", "warning"); }
  } catch (err) { authMessage(err.message || "Email verification failed.", "error"); }
  finally { busyForm(form, false); }
});
$("resendOtp").addEventListener("click", async () => {
  if (!supabaseClient) { authMessage("Supabase is not configured yet.", "error"); return; }
  const email = otpEmail || $("signupEmail").value.trim().toLowerCase();
  if (!email) { authMessage("Enter the email used to sign up first.", "error"); return; }
  const b = $("resendOtp"); b.disabled = true; b.textContent = "Sending…";
  try {
    const { error } = await supabaseClient.auth.resend({ type: "signup", email });
    if (error) authMessage(error.message, "error");
    else authMessage("A new signup verification email was requested. Check the Confirm signup email template if it contains a link rather than a code.", "success");
  } catch (err) { authMessage(err.message || "Could not resend the code.", "error"); }
  finally { b.disabled = false; b.textContent = "Resend code"; }
});

/* ---------------- Existing sports reporting UI ---------------- */
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
    return {...m, ...detail, home:detail.home && detail.home !== "Home" ? detail.home : m.home, away:detail.away && detail.away !== "Away" ? detail.away : m.away, hs:detail.hs ?? m.hs, as:detail.as ?? m.as, start:detail.start || m.start, league:detail.league || m.league, events:detail.events.length ? detail.events : m.events, setScores:detail.setScores?.length ? detail.setScores : m.setScores, raw:{...m.raw,...detail.raw}};
  } catch (_) { return m; }
}
async function load(silent = false) {
  if (currentGate !== "app" || !currentUser || !currentProfile || currentProfile.approval_status !== "approved") return;
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
  const q = ($("matchSearch")?.value || "").trim().toLowerCase();
  const shown = q ? lastData.map((m,i)=>({m,i})).filter(({m}) => [m.home,m.away,typeof m.league === "object" ? pick(m.league,["name","title"],"") : m.league,m.status].some(v=>String(v ?? "").toLowerCase().includes(q))) : lastData.map((m,i)=>({m,i}));
  if (!shown.length) { root.innerHTML = '<div class="empty">No match with that name is in the currently loaded results. Increase “Matches shown” (up to 50) or refresh. This field searches loaded results; it cannot fetch an arbitrary historical match by name.</div>'; return; }
  root.innerHTML = shown.map(({m,i}) => `<article class="card"><div class="card-main"><div class="league">${esc(typeof m.league === "object" ? pick(m.league,["name","title"],"") : m.league || sport.toUpperCase())}</div><div class="teams">${esc(m.home)}<br>${esc(m.away)}</div><div class="meta">${esc(labelStatus(m))} · Start: ${esc(ist(m.start))}</div><button data-report="${i}">Open post-match report →</button></div><div class="score">${esc(tennisMatchScore(m))}${sport === "tennis" ? `<div class="set-line">${tennisSetLine(m)}</div>` : ""}</div><div class="badge">${m.finished ? "Final" : m.live ? "Live" : "Match"}</div></article>`).join("");
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
  if (currentGate !== "app") return;
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
function startMatchApp() {
  if (matchAppStarted) { load(true); return; }
  matchAppStarted = true;
  load();
  if (+$("poll").value) timer = setInterval(() => load(true), +$("poll").value * 60000);
}
$("refresh").onclick = () => load(); $("limit").onchange = () => load();
document.querySelectorAll(".tab").forEach(b => b.onclick = () => { sport = b.dataset.sport; document.querySelectorAll(".tab").forEach(x => x.classList.toggle("active",x === b)); previous.clear(); load(); });
$("poll").onchange = () => { if (timer) clearInterval(timer); timer = null; if (currentGate === "app" && +$("poll").value) timer = setInterval(() => load(true), +$("poll").value * 60000); };
$("matchSearchForm").addEventListener("submit", e => { e.preventDefault(); render(); });
$("matchSearch").addEventListener("input", render);
$("enableNotify").onclick = async () => { if (!("Notification" in window)) { $("notifyStatus").textContent = "This browser does not support notifications."; return; } const p = await Notification.requestPermission(); $("notifyStatus").textContent = p === "granted" ? "Notifications enabled. Keep the app open for finish detection in this version." : "Notifications were not allowed. Enable them in browser/site settings."; };
$("testTone").onclick = () => { try { const ctx = new (window.AudioContext || window.webkitAudioContext)(); const o = ctx.createOscillator(), g = ctx.createGain(); o.connect(g); g.connect(ctx.destination); o.frequency.value = 880; g.gain.value = .12; o.start(); setTimeout(() => { o.stop(); ctx.close(); }, 220); } catch (_) { alert("Sound not available in this browser."); } };
$("closeDetail").onclick = () => $("detail").close();

/* ---------------- Admin approval dashboard ---------------- */
async function loadAdminUsers() {
  if (!supabaseClient || currentProfile?.role !== "admin" || currentProfile?.approval_status !== "approved") return;
  const root = $("adminUsers"); root.innerHTML = '<div class="empty">Loading users…</div>'; adminMessage("");
  const { data, error } = await supabaseClient.from("profiles")
    .select("id,full_name,email,role,approval_status,created_at")
    .order("created_at", { ascending: false });
  if (error) { root.innerHTML = '<div class="empty">Could not load users.</div>'; adminMessage("Could not load users: " + error.message, "error"); return; }
  if (!data?.length) { root.innerHTML = '<div class="empty">No profiles found.</div>'; return; }
  root.innerHTML = data.map(p => {
    const status = String(p.approval_status || "pending").toLowerCase();
    const isSelf = p.id === currentUser?.id;
    const isAdmin = p.role === "admin";
    let buttons = "";
    if (!isSelf && !isAdmin) {
      if (status !== "approved") buttons += `<button class="approve" data-user-action="approved" data-user-id="${esc(p.id)}">Approve</button>`;
      if (status !== "rejected") buttons += `<button class="plain" data-user-action="rejected" data-user-id="${esc(p.id)}">Reject</button>`;
      if (status !== "blocked") buttons += `<button class="danger" data-user-action="blocked" data-user-id="${esc(p.id)}">Block</button>`;
      else buttons += `<button class="approve" data-user-action="approved" data-user-id="${esc(p.id)}">Unblock</button>`;
    }
    const label = isSelf ? "You · admin" : isAdmin ? "Admin account" : "";
    const created = p.created_at ? ist(p.created_at) : "Date not supplied";
    return `<article class="admin-user"><div class="admin-user-info"><div class="admin-user-name">${esc(p.full_name || "Name not provided")}</div><div class="admin-user-email">${esc(p.email || "Email not provided")}</div><div class="admin-meta"><span class="admin-status ${esc(status)}">${esc(status)}</span><span class="admin-status">${esc(p.role || "user")}</span><span class="admin-user-email">Created: ${esc(created)}</span>${label ? `<span class="admin-status">${esc(label)}</span>` : ""}</div></div><div class="admin-actions">${buttons || '<span class="admin-user-email">No actions</span>'}</div></article>`;
  }).join("");
  root.querySelectorAll("[data-user-action]").forEach(button => button.addEventListener("click", () => updateUserApproval(button.dataset.userId, button.dataset.userAction, button)));
}
async function updateUserApproval(userId, nextStatus, button) {
  if (!supabaseClient || currentProfile?.role !== "admin" || currentProfile?.approval_status !== "approved") {
    adminMessage("Only an approved admin can change user access.", "error"); return;
  }
  if (!userId || userId === currentUser?.id) { adminMessage("You cannot change your own admin account here.", "error"); return; }
  const confirmation = nextStatus === "blocked" ? "Block this user's access?" : nextStatus === "rejected" ? "Reject this account?" : nextStatus === "approved" ? "Approve/unblock this account?" : "Change this user's status?";
  if (!window.confirm(confirmation)) return;
  button.disabled = true; button.textContent = "Saving…";
  const { data, error } = await supabaseClient.from("profiles").update({ approval_status: nextStatus }).eq("id", userId).select("id,approval_status").maybeSingle();
  if (error) { adminMessage("Could not update user: " + error.message, "error"); await loadAdminUsers(); return; }
  if (!data) { adminMessage("No profile was updated. Check the admin UPDATE policy and database permissions.", "error"); await loadAdminUsers(); return; }
  await loadAdminUsers();
  adminMessage(`User status changed to ${nextStatus}.`, "success");
}
$("refreshUsers").addEventListener("click", loadAdminUsers);

/* ---------------- Start app ---------------- */
async function boot() {
  const cfg = window.MATCH_REPORT_CONFIG || {};
  if (!window.supabase || typeof window.supabase.createClient !== "function") {
    authMessage("Supabase client library did not load. Check internet, then refresh the page.", "error");
    return;
  }
  if (!cfg.SUPABASE_URL || !cfg.SUPABASE_PUBLISHABLE_KEY || cfg.SUPABASE_PUBLISHABLE_KEY.includes("PASTE_YOUR_")) {
    authMessage("Setup needed: open config.js and paste your project's public/publishable (or legacy anon) key. Never use a secret or service_role key in the browser.", "warning");
    return;
  }
  try { supabaseClient = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_PUBLISHABLE_KEY); }
  catch (err) { authMessage("Supabase configuration error: " + (err.message || "check config.js"), "error"); return; }
  setGate("auth");
  const { data, error } = await supabaseClient.auth.getSession();
  if (error) { authMessage(error.message, "error"); return; }
  if (data?.session?.user) await routeSignedIn(data.session.user);
  else { setAuthMode("login"); authMessage("Sign in to continue, or create an account and verify your email."); }
}
if ("serviceWorker" in navigator) navigator.serviceWorker.register("./service-worker.js").catch(() => {});
boot();
