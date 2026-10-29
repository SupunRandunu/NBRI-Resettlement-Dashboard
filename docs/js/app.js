// ===== Config =====
const SPREADSHEET_ID = '10SXfXC4iaAPxgzVFdjDEhGDo8TB75Bhh_I9A3uCFXA0';
const RESETTLEMENT_GID = '0';
const DITHWAH_GID = '1129733636';
const DISTRICT_MAP = {
    'BAD': 'Badulla', 'KDY': 'Kandy', 'GAL': 'Galle', 'KAL': 'Kalutara',
    'RAT': 'Ratnapura', 'MTL': 'Matale', 'KEG': 'Kegalle', 'NUE': 'Nuwara Eliya', 'MAT': 'Matara',
};

// ===== Global State =====
let allData = [];
let filteredData = [];
let dithwahData = [];
let filteredDithwah = [];
let reportLinks = {};
let dithwahLinks = {};
let map = null;
let markers = [];
let sortCol = null;
let sortDir = 'asc';
let currentPage = 1;
let dSortCol = null;
let dSortDir = 'asc';
let dCurrentPage = 1;
const PAGE_SIZE = 15;

const COLORS = {
    blue: '#1da1f2', green: '#17bf63', orange: '#ffad1f', red: '#e0245e',
    purple: '#7856ff', teal: '#00d4aa', pink: '#f91880', cyan: '#00bcd4',
};
const CHART_COLORS = [COLORS.blue, COLORS.green, COLORS.orange, COLORS.red, COLORS.purple, COLORS.teal, COLORS.pink, COLORS.cyan];

// ===== CSV Parsing =====
function parseCSV(text) {
    const rows = [];
    let current = '';
    let inQuotes = false;
    const lines = [];
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch === '"') {
            if (inQuotes && text[i + 1] === '"') { current += '"'; i++; }
            else { inQuotes = !inQuotes; }
        } else if (ch === ',' && !inQuotes) {
            lines.push(current); current = '';
        } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
            if (current || lines.length) { lines.push(current); rows.push(lines.splice(0)); current = ''; }
            if (ch === '\r' && text[i + 1] === '\n') i++;
        } else {
            current += ch;
        }
    }
    if (current || lines.length) { lines.push(current); rows.push(lines.splice(0)); }
    return rows;
}

function csvToObjects(text) {
    const rows = parseCSV(text);
    if (rows.length < 2) return [];
    const headers = rows[0].map(h => h.trim());
    return rows.slice(1).map(row => {
        const obj = {};
        headers.forEach((h, i) => { obj[h] = (row[i] || '').trim(); });
        return obj;
    }).filter(obj => {
        const first = obj[headers[0]] || '';
        return first.trim() !== '';
    });
}

// ===== GPS Parsing =====
function parseGPS(coord) {
    if (!coord || !coord.trim()) return null;
    coord = coord.trim().replace(/°/g, '');
    try {
        if (coord.includes(',') && !/[NSEWnsew]/.test(coord)) {
            const [a, b] = coord.split(',').map(s => parseFloat(s.trim()));
            if (!isNaN(a) && !isNaN(b)) return [a, b];
        }
        const parts = coord.split(/\s+/);
        if (parts.length >= 2) {
            let lat = parseFloat(parts[0].replace(/[NSns]/g, ''));
            if (parts[0].slice(-1).toLowerCase() === 's') lat = -lat;
            let lng = parseFloat(parts[1].replace(/[EWew]/g, ''));
            if (parts[1].slice(-1).toLowerCase() === 'w') lng = -lng;
            if (!isNaN(lat) && !isNaN(lng)) return [lat, lng];
        }
    } catch (e) {}
    return null;
}

// ===== Fetch from Google Sheets =====
async function fetchSheetCSV(gid) {
    const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv&gid=${gid}`;
    const resp = await fetch(url);
    return await resp.text();
}

// ===== Init =====
document.addEventListener('DOMContentLoaded', async () => {
    showLoader(true);
    try {
        const [resText, dithText, rlResp, dlResp] = await Promise.all([
            fetchSheetCSV(RESETTLEMENT_GID),
            fetchSheetCSV(DITHWAH_GID),
            fetch('data/report_links.json').then(r => r.json()).catch(() => ({})),
            fetch('data/dithwah_2026.json').then(r => r.json()).catch(() => []),
        ]);

        reportLinks = rlResp;

        // Build dithwah link map from local JSON (keyed by serial)
        if (Array.isArray(dlResp)) {
            dlResp.forEach(r => {
                const serial = (r[''] || '').trim();
                if (serial && r.FileLink) dithwahLinks[serial] = r.FileLink;
            });
        }

        // Parse resettlement
        const resRows = csvToObjects(resText);
        allData = resRows.map(r => {
            const serial = (r['  Serial No.'] || r['Serial No.'] || '').trim();
            const distCode = (r['Dist. Code'] || '').trim();
            const gps = parseGPS(r['GPS Coordinate'] || '');
            const linkInfo = reportLinks[serial] || {};
            return {
                serial, ref: r['Ref. No.'] || '', year: r['Year'] || '',
                distCode, district: DISTRICT_MAP[distCode] || r['RS District'] || '',
                dsd: r['RS DSD'] || '', status: r['Working Status'] || '',
                officer: r['Officer Attended'] || '',
                beneficiary: r['Name of the Beneficiary'] || '',
                plots: r['Number of Plots'] || '',
                approval: r['Approval Status'] || '',
                report: r['Report'] || '', reportLink: linkInfo.link || '',
                coverDate: r['Date on Cover Letter'] || '',
                receivedDate: r['Date Received to NBRO Head Office'] || '',
                lssdReceived: r['LSSD Report Recieved'] || r['LSSD Report Received'] || '',
                lssdDate: r['LSSD Report Recieved Date'] || r['LSSD Report Received Date'] || '',
                inspectionDate: r['Site Inspection Date'] || '',
                issuedDate: r['Report Issued Date'] || '',
                gps, gpsRaw: r['GPS Coordinate'] || '',
                resettlementType: r['Resettlement Type'] || '',
                contact: r['Contact No.'] || '',
                remarks: r['Remarks'] || '',
                uploadStatus: r['Upload to Database'] || '',
            };
        });
        filteredData = [...allData];

        // Parse dithwah
        const dithRows = csvToObjects(dithText);
        dithwahData = dithRows.map(r => {
            const serial = (r[' '] || r[''] || Object.values(r)[0] || '').trim();
            const loc = r['Location'] || '';
            const gps = parseGPS(loc);
            const dist = (r['District '] || r['District'] || '').trim();
            return {
                serial, ref: r['Ref. No.'] || '', year: r['Year'] || '',
                issuedDate: r['Issued Date'] || '',
                landName: r['Land Name'] || '',
                file: r['File'] || '', fileLink: dithwahLinks[serial] || '',
                distCode: dist, district: DISTRICT_MAP[dist] || dist,
                reportStatus: r['Status of Report'] || '',
                requestDate: r['Request Date'] || '',
                receivedDate: r['Recieved Date'] || '',
                letterRef: r['Letter Ref.'] || '',
                dsd: r['DSD'] || '', gnd: r['GND'] || '',
                gps, gpsRaw: loc,
                area: r['Area (Acres)'] || '',
                expectedBlocks: r['Expected Blocks'] || '',
                workingStatus: r['Working Status'] || '',
                inspectionDate: r['Inspection Date'] || '',
                approval: r['Status of Approval'] || '',
                remarks: r['Remaks '] || r['Remaks'] || '',
                uploadStatus: r['Upload to Database'] || '',
            };
        });
        filteredDithwah = [...dithwahData];

    } catch (e) {
        console.error('Failed to load data:', e);
    }

    showLoader(false);
    setupNavigation();
    setupThemeToggle();
    setupMobileMenu();
    setupFilters();
    setupRecordsTabs();
    setupMetricClicks();
    renderDashboard();
    setTimeout(initMap, 200);
});

function showLoader(show) {
    const el = document.getElementById('global-loader');
    if (el) el.style.display = show ? 'flex' : 'none';
}

// ===== Navigation =====
function setupNavigation() {
    document.querySelectorAll('.nav-item[data-section]').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const section = item.dataset.section;
            document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
            item.classList.add('active');
            document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
            const target = document.getElementById(section);
            if (target) {
                target.classList.add('active');
                document.getElementById('page-title').textContent = item.querySelector('.nav-text').textContent;
            }
            window.dispatchEvent(new Event('resize'));
        });
    });
}

// ===== Theme =====
function setupThemeToggle() {
    const btn = document.getElementById('theme-toggle');
    const saved = localStorage.getItem('theme') || 'dark';
    document.documentElement.setAttribute('data-theme', saved);
    updateThemeIcon(saved);
    btn.addEventListener('click', () => {
        const current = document.documentElement.getAttribute('data-theme');
        const next = current === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('theme', next);
        updateThemeIcon(next);
        rebuildCharts();
    });
}

function updateThemeIcon(theme) {
    document.querySelector('#theme-toggle span').textContent = theme === 'dark' ? '\u2600\uFE0F' : '\uD83C\uDF19';
}

// ===== Mobile Menu =====
function setupMobileMenu() {
    const toggle = document.getElementById('menu-toggle');
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.querySelector('.sidebar-overlay');
    if (toggle) toggle.addEventListener('click', () => { sidebar.classList.toggle('open'); overlay.classList.toggle('active'); });
    if (overlay) overlay.addEventListener('click', () => { sidebar.classList.remove('open'); overlay.classList.remove('active'); });
}

// ===== Metric Card Clicks =====
function setupMetricClicks() {
    document.querySelectorAll('.metric-card.clickable').forEach(card => {
        card.addEventListener('click', () => {
            const filter = card.dataset.filter;
            document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
            const recordsNav = document.querySelector('.nav-item[data-section="section-records"]');
            if (recordsNav) recordsNav.classList.add('active');
            document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
            document.getElementById('section-records').classList.add('active');
            document.getElementById('page-title').textContent = 'Records';
            document.querySelectorAll('#records-tabs .tab-pill').forEach(b => b.classList.remove('active'));
            document.querySelector('#records-tabs .tab-pill[data-tab="resettlement"]').classList.add('active');
            document.getElementById('tab-resettlement').style.display = '';
            document.getElementById('tab-dithwah').style.display = 'none';
            const searchInput = document.getElementById('table-search');
            if (filter === 'all') { searchInput.value = ''; filteredData = [...allData]; }
            else if (filter === 'gps') { searchInput.value = ''; filteredData = allData.filter(d => d.gps); }
            else { const [field, value] = filter.split(':'); searchInput.value = ''; filteredData = allData.filter(d => d[field] === value); }
            currentPage = 1;
            renderTable();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    });
}

// ===== Filters =====
function setupFilters() {
    const distFilter = document.getElementById('filter-district');
    const statusFilter = document.getElementById('filter-status');
    const approvalFilter = document.getElementById('filter-approval');
    const typeFilter = document.getElementById('filter-type');
    const resetBtn = document.getElementById('filter-reset');
    populateSelect(distFilter, [...new Set(allData.map(d => d.district).filter(Boolean))].sort());
    populateSelect(statusFilter, [...new Set(allData.map(d => d.status).filter(Boolean))].sort());
    populateSelect(approvalFilter, [...new Set(allData.map(d => d.approval).filter(Boolean))].sort());
    populateSelect(typeFilter, [...new Set(allData.map(d => d.resettlementType).filter(Boolean))].sort());
    [distFilter, statusFilter, approvalFilter, typeFilter].forEach(el => el.addEventListener('change', applyFilters));
    resetBtn.addEventListener('click', () => { distFilter.value = ''; statusFilter.value = ''; approvalFilter.value = ''; typeFilter.value = ''; applyFilters(); });
}

function populateSelect(el, options) {
    options.forEach(opt => { const o = document.createElement('option'); o.value = opt; o.textContent = opt; el.appendChild(o); });
}

function applyFilters() {
    const dist = document.getElementById('filter-district').value;
    const status = document.getElementById('filter-status').value;
    const approval = document.getElementById('filter-approval').value;
    const type = document.getElementById('filter-type').value;
    filteredData = allData.filter(d => {
        if (dist && d.district !== dist) return false;
        if (status && d.status !== status) return false;
        if (approval && d.approval !== approval) return false;
        if (type && d.resettlementType !== type) return false;
        return true;
    });
    currentPage = 1;
    renderDashboard();
}

// ===== Render Dashboard =====
function renderDashboard() { renderMetrics(); renderCharts(); renderTable(); if (map) updateMapMarkers(); }

// ===== Metrics =====
function renderMetrics() {
    const total = filteredData.length;
    const issued = filteredData.filter(d => d.status === 'Report Issued').length;
    const inspected = filteredData.filter(d => d.status === 'Inspected').length;
    const notInspected = filteredData.filter(d => d.status === 'Not Inspected').length;
    const approved = filteredData.filter(d => d.approval === 'Approved').length;
    const withGps = filteredData.filter(d => d.gps).length;
    document.getElementById('metric-total').textContent = total;
    document.getElementById('metric-issued').textContent = issued;
    document.getElementById('metric-inspected').textContent = inspected;
    document.getElementById('metric-not-inspected').textContent = notInspected;
    document.getElementById('metric-approved').textContent = approved;
    document.getElementById('metric-gps').textContent = withGps;
    const pctIssued = total ? Math.round((issued / total) * 100) : 0;
    const pctApproved = total ? Math.round((approved / total) * 100) : 0;
    document.getElementById('metric-issued-pct').textContent = `${pctIssued}% of total`;
    document.getElementById('metric-approved-pct').textContent = `${pctApproved}% of total`;
}

// ===== Charts =====
let chartInstances = {};
function destroyCharts() { Object.values(chartInstances).forEach(c => c.destroy()); chartInstances = {}; }
function rebuildCharts() { destroyCharts(); renderCharts(); }
function getChartFontColor() { return document.documentElement.getAttribute('data-theme') === 'light' ? '#536471' : '#8899a6'; }
function getGridColor() { return document.documentElement.getAttribute('data-theme') === 'light' ? '#e1e8ed' : '#2f3e4e'; }

function renderCharts() {
    destroyCharts();
    const fontColor = getChartFontColor();
    const gridColor = getGridColor();
    const statusData = countBy(filteredData, 'status');
    chartInstances.status = new Chart(document.getElementById('chart-status'), { type: 'doughnut', data: { labels: Object.keys(statusData), datasets: [{ data: Object.values(statusData), backgroundColor: [COLORS.green, COLORS.blue, COLORS.red, COLORS.orange], borderWidth: 0, hoverOffset: 8 }] }, options: { responsive: true, maintainAspectRatio: false, cutout: '65%', plugins: { legend: { position: 'bottom', labels: { color: fontColor, padding: 16, usePointStyle: true, pointStyleWidth: 8 } } } } });
    const approvalData = countBy(filteredData, 'approval');
    chartInstances.approval = new Chart(document.getElementById('chart-approval'), { type: 'doughnut', data: { labels: Object.keys(approvalData), datasets: [{ data: Object.values(approvalData), backgroundColor: [COLORS.green, COLORS.orange, COLORS.red, COLORS.purple], borderWidth: 0, hoverOffset: 8 }] }, options: { responsive: true, maintainAspectRatio: false, cutout: '65%', plugins: { legend: { position: 'bottom', labels: { color: fontColor, padding: 16, usePointStyle: true, pointStyleWidth: 8 } } } } });
    const distData = countBy(filteredData, 'district');
    chartInstances.district = new Chart(document.getElementById('chart-district'), { type: 'bar', data: { labels: Object.keys(distData), datasets: [{ label: 'Applications', data: Object.values(distData), backgroundColor: CHART_COLORS.slice(0, Object.keys(distData).length), borderRadius: 6, borderSkipped: false }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: fontColor }, grid: { display: false } }, y: { ticks: { color: fontColor, stepSize: 1 }, grid: { color: gridColor } } } } });
    const typeData = countBy(filteredData, 'resettlementType');
    chartInstances.type = new Chart(document.getElementById('chart-type'), { type: 'polarArea', data: { labels: Object.keys(typeData), datasets: [{ data: Object.values(typeData), backgroundColor: CHART_COLORS.map(c => c + '99'), borderColor: CHART_COLORS, borderWidth: 2 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: fontColor, padding: 12, usePointStyle: true, pointStyleWidth: 8 } } }, scales: { r: { ticks: { color: fontColor, backdropColor: 'transparent' }, grid: { color: gridColor } } } } });
    const monthlyData = {};
    filteredData.forEach(d => { if (d.issuedDate) { try { const parts = d.issuedDate.split('/'); if (parts.length === 3) { const key = `${parts[2]}-${parts[0].padStart(2, '0')}`; monthlyData[key] = (monthlyData[key] || 0) + 1; } } catch(e) {} } });
    const sortedMonths = Object.keys(monthlyData).sort();
    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const monthLabels = sortedMonths.map(m => { const [y, mo] = m.split('-'); return `${monthNames[parseInt(mo)-1]} ${y}`; });
    chartInstances.timeline = new Chart(document.getElementById('chart-timeline'), { type: 'line', data: { labels: monthLabels, datasets: [{ label: 'Reports Issued', data: sortedMonths.map(m => monthlyData[m]), borderColor: COLORS.blue, backgroundColor: COLORS.blue + '22', fill: true, tension: 0.4, pointRadius: 5, pointHoverRadius: 8, pointBackgroundColor: COLORS.blue, pointBorderColor: '#fff', pointBorderWidth: 2 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: fontColor }, grid: { color: gridColor } }, y: { beginAtZero: true, ticks: { color: fontColor, stepSize: 1 }, grid: { color: gridColor } } } } });
    const dsdData = countBy(filteredData, 'dsd');
    const sortedDSD = Object.entries(dsdData).sort((a, b) => b[1] - a[1]);
    chartInstances.dsd = new Chart(document.getElementById('chart-dsd'), { type: 'bar', data: { labels: sortedDSD.map(e => e[0]), datasets: [{ label: 'Applications', data: sortedDSD.map(e => e[1]), backgroundColor: COLORS.teal + 'cc', borderRadius: 6, borderSkipped: false }] }, options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: fontColor, stepSize: 1 }, grid: { color: gridColor } }, y: { ticks: { color: fontColor, font: { size: 11 } }, grid: { display: false } } } } });
    const lssdTrue = filteredData.filter(d => d.lssdReceived === 'TRUE').length;
    const lssdFalse = filteredData.filter(d => d.lssdReceived === 'FALSE').length;
    chartInstances.lssd = new Chart(document.getElementById('chart-lssd'), { type: 'pie', data: { labels: ['Received', 'Not Received'], datasets: [{ data: [lssdTrue, lssdFalse], backgroundColor: [COLORS.green + 'cc', COLORS.red + 'cc'], borderWidth: 0, hoverOffset: 6 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: fontColor, padding: 16, usePointStyle: true, pointStyleWidth: 8 } } } } });
    const officerData = {};
    filteredData.forEach(d => { const off = d.officer?.trim(); if (off && !off.includes('@')) officerData[off] = (officerData[off] || 0) + 1; });
    const sortedOfficers = Object.entries(officerData).sort((a, b) => b[1] - a[1]);
    chartInstances.officer = new Chart(document.getElementById('chart-officer'), { type: 'bar', data: { labels: sortedOfficers.map(e => e[0]), datasets: [{ label: 'Assignments', data: sortedOfficers.map(e => e[1]), backgroundColor: COLORS.purple + 'cc', borderRadius: 6, borderSkipped: false }] }, options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: fontColor, stepSize: 1 }, grid: { color: gridColor } }, y: { ticks: { color: fontColor, font: { size: 11 } }, grid: { display: false } } } } });
}

function countBy(arr, key) { const c = {}; arr.forEach(i => { const v = i[key]?.trim(); if (v) c[v] = (c[v] || 0) + 1; }); return c; }

// ===== Data Table =====
function renderTable() {
    const tbody = document.getElementById('table-body');
    const searchInput = document.getElementById('table-search');
    let displayData = [...filteredData];
    const query = searchInput ? searchInput.value.toLowerCase() : '';
    if (query) displayData = displayData.filter(d => (d.serial + ' ' + d.beneficiary + ' ' + d.district + ' ' + d.dsd + ' ' + d.status + ' ' + d.approval + ' ' + d.resettlementType).toLowerCase().includes(query));
    if (sortCol) displayData.sort((a, b) => { let va = a[sortCol] || '', vb = b[sortCol] || ''; if (!isNaN(va) && !isNaN(vb) && va !== '' && vb !== '') { va = parseFloat(va); vb = parseFloat(vb); } if (va < vb) return sortDir === 'asc' ? -1 : 1; if (va > vb) return sortDir === 'asc' ? 1 : -1; return 0; });
    const totalPages = Math.ceil(displayData.length / PAGE_SIZE);
    if (currentPage > totalPages) currentPage = totalPages || 1;
    const start = (currentPage - 1) * PAGE_SIZE;
    const pageData = displayData.slice(start, start + PAGE_SIZE);
    tbody.innerHTML = pageData.map(d => `<tr><td>${d.serial}</td><td title="${escHtml(d.beneficiary)}">${d.beneficiary}</td><td>${d.district}</td><td>${d.dsd}</td><td>${statusBadge(d.status)}</td><td>${approvalBadge(d.approval)}</td><td>${d.resettlementType}</td><td>${d.inspectionDate || '-'}</td><td>${d.issuedDate || '-'}</td><td>${fileLink(d.report, d.reportLink)}</td><td>${d.gps ? '\u{1F4CD}' : '-'}</td></tr>`).join('');
    document.getElementById('table-info').textContent = `Showing ${displayData.length ? start + 1 : 0}-${Math.min(start + PAGE_SIZE, displayData.length)} of ${displayData.length}`;
    renderPagination('table-pagination', currentPage, totalPages, p => { currentPage = p; renderTable(); });
}

function renderPagination(elId, current, totalPages, onPage) {
    const pagination = document.getElementById(elId);
    pagination.innerHTML = '';
    const prevBtn = document.createElement('button'); prevBtn.textContent = '\u2190 Prev'; prevBtn.disabled = current <= 1;
    prevBtn.addEventListener('click', () => onPage(current - 1)); pagination.appendChild(prevBtn);
    const maxButtons = 7; let startPage = Math.max(1, current - Math.floor(maxButtons / 2)); let endPage = Math.min(totalPages, startPage + maxButtons - 1);
    if (endPage - startPage < maxButtons - 1) startPage = Math.max(1, endPage - maxButtons + 1);
    for (let i = startPage; i <= endPage; i++) { const btn = document.createElement('button'); btn.textContent = i; btn.className = i === current ? 'active' : ''; btn.addEventListener('click', () => onPage(i)); pagination.appendChild(btn); }
    const nextBtn = document.createElement('button'); nextBtn.textContent = 'Next \u2192'; nextBtn.disabled = current >= totalPages;
    nextBtn.addEventListener('click', () => onPage(current + 1)); pagination.appendChild(nextBtn);
}

function statusBadge(status) { if (!status) return '-'; const cls = status === 'Report Issued' ? 'badge-issued' : status === 'Inspected' ? 'badge-inspected' : 'badge-not-inspected'; return `<span class="badge ${cls}">${status}</span>`; }
function approvalBadge(approval) { if (!approval) return '-'; const cls = approval === 'Approved' ? 'badge-approved' : approval === 'Rejected' ? 'badge-rejected' : 'badge-conditions'; return `<span class="badge ${cls}">${approval}</span>`; }
function fileLink(fileName, url) { if (!fileName || !fileName.trim()) return '-'; if (url && url.trim()) return `<a href="${url}" target="_blank" rel="noopener" class="report-link" title="${escHtml(fileName)}">&#x1F4C4; ${escHtml(fileName)}</a>`; return `<span class="report-link" style="opacity:0.5;cursor:default;" title="${escHtml(fileName)}">&#x1F4C4; ${escHtml(fileName)}</span>`; }
function escHtml(str) { if (!str) return ''; return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function dithwahStatusBadge(status) { if (!status) return '-'; const s = status.toLowerCase(); const cls = s.includes('issued') ? 'badge-issued' : s.includes('done') ? 'badge-issued' : s.includes('pending') ? 'badge-conditions' : s.includes('not') ? 'badge-not-inspected' : 'badge-inspected'; return `<span class="badge ${cls}">${status}</span>`; }

// Table sort & search
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.data-table thead th[data-sort]').forEach(th => {
        th.addEventListener('click', () => { const col = th.dataset.sort; if (sortCol === col) sortDir = sortDir === 'asc' ? 'desc' : 'asc'; else { sortCol = col; sortDir = 'asc'; } document.querySelectorAll('.data-table thead th').forEach(t => { const icon = t.querySelector('.sort-icon'); if (icon) icon.textContent = ''; }); const icon = th.querySelector('.sort-icon'); if (icon) icon.textContent = sortDir === 'asc' ? '\u25B2' : '\u25BC'; renderTable(); });
    });
    const searchInput = document.getElementById('table-search');
    if (searchInput) searchInput.addEventListener('input', () => { currentPage = 1; renderTable(); });
});

// ===== Map =====
function initMap() {
    map = L.map('map', { zoomControl: true, scrollWheelZoom: true }).setView([7.0, 80.8], 8);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors', maxZoom: 18 }).addTo(map);
    updateMapMarkers();
    setTimeout(() => map.invalidateSize(), 200);
}

function updateMapMarkers() {
    if (!map) return;
    markers.forEach(m => map.removeLayer(m)); markers = [];
    const approvalColors = { 'Approved': COLORS.green, 'Approved with Conditions': COLORS.orange, 'Rejected': COLORS.red };
    const bounds = [];
    filteredData.forEach(d => {
        if (d.gps) {
            const [lat, lng] = d.gps;
            const color = approvalColors[d.approval] || COLORS.blue;
            const marker = L.circleMarker([lat, lng], { radius: 8, fillColor: color, fillOpacity: 0.85, color: '#fff', weight: 2 }).addTo(map);
            marker.bindPopup(`<div style="font-family:Inter,sans-serif;font-size:13px;line-height:1.5;"><strong>#${d.serial}</strong> - ${d.beneficiary}<br><b>District:</b> ${d.district} / ${d.dsd}<br><b>Status:</b> ${d.status}<br><b>Approval:</b> ${d.approval || 'Pending'}<br><b>Type:</b> ${d.resettlementType}<br><b>GPS:</b> ${d.gpsRaw}</div>`);
            markers.push(marker); bounds.push([lat, lng]);
        }
    });
    if (bounds.length > 0) map.fitBounds(bounds, { padding: [30, 30] });
}

// ===== Export CSV =====
function exportCSV() {
    const headers = ['Serial', 'Beneficiary', 'District', 'DSD', 'Status', 'Approval', 'Type', 'Inspection Date', 'Issued Date', 'Report File', 'GPS'];
    const rows = filteredData.map(d => [d.serial, d.beneficiary, d.district, d.dsd, d.status, d.approval, d.resettlementType, d.inspectionDate, d.issuedDate, d.report, d.gpsRaw]);
    let csv = headers.join(',') + '\n'; rows.forEach(r => { csv += r.map(v => `"${(v || '').replace(/"/g, '""')}"`).join(',') + '\n'; });
    const blob = new Blob([csv], { type: 'text/csv' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'nbro_data_export.csv'; a.click(); URL.revokeObjectURL(url);
}

// ===== Dithwah 2026 =====
function setupRecordsTabs() {
    document.querySelectorAll('#records-tabs .tab-pill').forEach(btn => {
        btn.addEventListener('click', () => { document.querySelectorAll('#records-tabs .tab-pill').forEach(b => b.classList.remove('active')); btn.classList.add('active'); const tab = btn.dataset.tab; document.getElementById('tab-resettlement').style.display = tab === 'resettlement' ? '' : 'none'; document.getElementById('tab-dithwah').style.display = tab === 'dithwah' ? '' : 'none'; if (tab === 'dithwah') renderDithwahTable(); });
    });
    const dSearch = document.getElementById('dithwah-search');
    if (dSearch) dSearch.addEventListener('input', () => { dCurrentPage = 1; renderDithwahTable(); });
    document.querySelectorAll('#dithwah-table thead th[data-dsort]').forEach(th => {
        th.addEventListener('click', () => { const col = th.dataset.dsort; if (dSortCol === col) dSortDir = dSortDir === 'asc' ? 'desc' : 'asc'; else { dSortCol = col; dSortDir = 'asc'; } document.querySelectorAll('#dithwah-table thead th').forEach(t => { const icon = t.querySelector('.sort-icon'); if (icon) icon.textContent = ''; }); const icon = th.querySelector('.sort-icon'); if (icon) icon.textContent = dSortDir === 'asc' ? '\u25B2' : '\u25BC'; renderDithwahTable(); });
    });
}

function renderDithwahTable() {
    const tbody = document.getElementById('dithwah-body');
    const searchInput = document.getElementById('dithwah-search');
    let displayData = [...filteredDithwah];
    const query = searchInput ? searchInput.value.toLowerCase() : '';
    if (query) displayData = displayData.filter(d => (d.serial + ' ' + d.landName + ' ' + d.district + ' ' + d.dsd + ' ' + d.gnd + ' ' + d.reportStatus + ' ' + d.approval + ' ' + d.file).toLowerCase().includes(query));
    if (dSortCol) displayData.sort((a, b) => { let va = a[dSortCol] || '', vb = b[dSortCol] || ''; if (!isNaN(va) && !isNaN(vb) && va !== '' && vb !== '') { va = parseFloat(va); vb = parseFloat(vb); } if (va < vb) return dSortDir === 'asc' ? -1 : 1; if (va > vb) return dSortDir === 'asc' ? 1 : -1; return 0; });
    const totalPages = Math.ceil(displayData.length / PAGE_SIZE);
    if (dCurrentPage > totalPages) dCurrentPage = totalPages || 1;
    const start = (dCurrentPage - 1) * PAGE_SIZE;
    const pageData = displayData.slice(start, start + PAGE_SIZE);
    tbody.innerHTML = pageData.map(d => `<tr><td>${d.serial}</td><td title="${escHtml(d.landName)}">${d.landName}</td><td>${d.district}</td><td>${d.dsd}</td><td>${d.gnd}</td><td>${dithwahStatusBadge(d.reportStatus)}</td><td>${approvalBadge(d.approval)}</td><td>${d.requestDate || '-'}</td><td>${d.area || '-'}</td><td>${fileLink(d.file, d.fileLink)}</td><td>${d.gps ? '\u{1F4CD}' : '-'}</td></tr>`).join('');
    document.getElementById('dithwah-info').textContent = `Showing ${displayData.length ? start + 1 : 0}-${Math.min(start + PAGE_SIZE, displayData.length)} of ${displayData.length}`;
    renderPagination('dithwah-pagination', dCurrentPage, totalPages, p => { dCurrentPage = p; renderDithwahTable(); });
}

function exportDithwahCSV() {
    const headers = ['#', 'Land Name', 'District', 'DSD', 'GND', 'Report Status', 'Approval', 'Request Date', 'Area', 'File', 'File Link', 'GPS'];
    const rows = filteredDithwah.map(d => [d.serial, d.landName, d.district, d.dsd, d.gnd, d.reportStatus, d.approval, d.requestDate, d.area, d.file, d.fileLink, d.gpsRaw]);
    let csv = headers.join(',') + '\n'; rows.forEach(r => { csv += r.map(v => `"${(v || '').replace(/"/g, '""')}"`).join(',') + '\n'; });
    const blob = new Blob([csv], { type: 'text/csv' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'dithwah_2026_export.csv'; a.click(); URL.revokeObjectURL(url);
}
