// ===== Global State =====
// Security fix #14: Client-side filtering is by design for this public read-only dashboard.
// All data is sourced from a publicly shared Google Spreadsheet with no sensitive information.
// Security fix #19: The Spreadsheet ID visible in browser network requests is acceptable
// because the spreadsheet is publicly shared / read-only.
let allData = [];
let filteredData = [];
let dithwahData = [];
let filteredDithwah = [];
let summary = {};
let map = null;
let markers = [];
let sortCol = null;
let sortDir = 'asc';
let currentPage = 1;
let dSortCol = null;
let dSortDir = 'asc';
let dCurrentPage = 1;
const PAGE_SIZE = 15;

// ===== Color Palette =====
const COLORS = {
    blue: '#1da1f2',
    green: '#17bf63',
    orange: '#ffad1f',
    red: '#e0245e',
    purple: '#7856ff',
    teal: '#00d4aa',
    pink: '#f91880',
    cyan: '#00bcd4',
};

const CHART_COLORS = [
    COLORS.blue, COLORS.green, COLORS.orange, COLORS.red,
    COLORS.purple, COLORS.teal, COLORS.pink, COLORS.cyan,
];

// ===== Init =====
document.addEventListener('DOMContentLoaded', async () => {
    await loadData();
    await loadDithwahData();
    setupNavigation();
    setupThemeToggle();
    setupMobileMenu();
    setupFilters();
    setupRecordsTabs();
    setupMetricClicks();
    renderDashboard();
    setTimeout(initMap, 200);
});

// ===== Data Loading =====
async function loadData() {
    try {
        const [dataRes, summaryRes] = await Promise.all([
            fetch('/api/data'),
            fetch('/api/summary'),
        ]);
        allData = await dataRes.json();
        summary = await summaryRes.json();
        filteredData = [...allData];
    } catch (e) {
        console.error('Failed to load data:', e);
    }
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
                // Update topbar title
                document.getElementById('page-title').textContent = item.querySelector('.nav-text').textContent;
            }
            // Resize charts
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
    const icon = document.querySelector('#theme-toggle span');
    icon.textContent = theme === 'dark' ? '\u2600\uFE0F' : '\uD83C\uDF19';
}

// ===== Mobile Menu =====
function setupMobileMenu() {
    const toggle = document.getElementById('menu-toggle');
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.querySelector('.sidebar-overlay');
    if (toggle) {
        toggle.addEventListener('click', () => {
            sidebar.classList.toggle('open');
            overlay.classList.toggle('active');
        });
    }
    if (overlay) {
        overlay.addEventListener('click', () => {
            sidebar.classList.remove('open');
            overlay.classList.remove('active');
        });
    }
}

// ===== Filters =====
// ===== Metric Card Clicks =====
function setupMetricClicks() {
    document.querySelectorAll('.metric-card.clickable').forEach(card => {
        card.addEventListener('click', () => {
            const filter = card.dataset.dfilter;
            if (!filter) return;

            // Navigate to Records section
            document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
            const recordsNav = document.querySelector('.nav-item[data-section="section-records"]');
            if (recordsNav) recordsNav.classList.add('active');
            document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
            document.getElementById('section-records').classList.add('active');
            document.getElementById('page-title').textContent = 'Records';

            // Make sure Dithwah tab is active
            document.querySelectorAll('#records-tabs .tab-pill').forEach(b => b.classList.remove('active'));
            document.querySelector('#records-tabs .tab-pill[data-tab="dithwah"]').classList.add('active');
            document.getElementById('tab-resettlement').style.display = 'none';
            document.getElementById('tab-dithwah').style.display = '';

            // Apply the filter on Dithwah data
            const searchInput = document.getElementById('dithwah-search');
            searchInput.value = '';
            if (filter === 'all') {
                filteredDithwah = [...dithwahData];
            } else if (filter === 'gps') {
                filteredDithwah = dithwahData.filter(d => d.gps);
            } else if (filter === 'approved') {
                filteredDithwah = dithwahData.filter(d => d.approval === 'Approved' || d.approval === 'Approved with condition');
            } else {
                const [field, value] = filter.split(':');
                filteredDithwah = dithwahData.filter(d => d[field] === value);
            }

            dCurrentPage = 1;
            renderDithwahTable();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    });
}

// Extract ref type from last part of Ref. No. (e.g. "NBRO/HSPTD/NLRP-D/SI/GRS/" -> "GRS")
function getRefType(ref) {
    if (!ref) return '';
    const parts = ref.replace(/\/+$/, '').split('/');
    return parts[parts.length - 1] || '';
}

function setupFilters() {
    const distFilter = document.getElementById('filter-district');
    const statusFilter = document.getElementById('filter-status');
    const approvalFilter = document.getElementById('filter-approval');
    const refTypeFilter = document.getElementById('filter-reftype');
    const typeFilter = document.getElementById('filter-type');
    const resetBtn = document.getElementById('filter-reset');

    // Populate from Dithwah data
    const districts = [...new Set(dithwahData.map(d => d.district).filter(Boolean))].sort();
    const statuses = [...new Set(dithwahData.map(d => d.reportStatus).filter(Boolean))].sort();
    const approvals = [...new Set(dithwahData.map(d => d.approval).filter(Boolean))].sort();
    const refTypes = [...new Set(dithwahData.map(d => getRefType(d.ref)).filter(Boolean))].sort();
    const dsds = [...new Set(dithwahData.map(d => d.dsd).filter(Boolean))].sort();

    populateSelect(distFilter, districts);
    populateSelect(statusFilter, statuses);
    populateSelect(approvalFilter, approvals);
    populateSelect(refTypeFilter, refTypes);
    populateSelect(typeFilter, dsds);

    // When district changes, update DSD options
    distFilter.addEventListener('change', () => {
        const selectedDist = distFilter.value;
        const filtered = selectedDist
            ? dithwahData.filter(d => d.district === selectedDist)
            : dithwahData;
        const dsds = [...new Set(filtered.map(d => d.dsd).filter(Boolean))].sort();
        typeFilter.innerHTML = '<option value="">All DSDs</option>';
        populateSelect(typeFilter, dsds);
        applyFilters();
    });

    [statusFilter, approvalFilter, refTypeFilter, typeFilter].forEach(el => {
        el.addEventListener('change', applyFilters);
    });

    resetBtn.addEventListener('click', () => {
        distFilter.value = '';
        statusFilter.value = '';
        approvalFilter.value = '';
        refTypeFilter.value = '';
        typeFilter.innerHTML = '<option value="">All DSDs</option>';
        populateSelect(typeFilter, [...new Set(dithwahData.map(d => d.dsd).filter(Boolean))].sort());
        typeFilter.value = '';
        applyFilters();
    });
}

function populateSelect(el, options) {
    options.forEach(opt => {
        const o = document.createElement('option');
        o.value = opt;
        o.textContent = opt;
        el.appendChild(o);
    });
}

function applyFilters() {
    const dist = document.getElementById('filter-district').value;
    const status = document.getElementById('filter-status').value;
    const approval = document.getElementById('filter-approval').value;
    const refType = document.getElementById('filter-reftype').value;
    const dsd = document.getElementById('filter-type').value;

    filteredDithwah = dithwahData.filter(d => {
        if (dist && d.district !== dist) return false;
        if (status && d.reportStatus !== status) return false;
        if (approval && d.approval !== approval) return false;
        if (refType && getRefType(d.ref) !== refType) return false;
        if (dsd && d.dsd !== dsd) return false;
        return true;
    });

    dCurrentPage = 1;
    renderDashboard();
}

// ===== Render Dashboard =====
function renderDashboard() {
    renderMetrics();
    renderCharts();
    renderTable();
    renderDithwahTable();
    if (map) updateMapMarkers();
}

// ===== Metrics (Dithwah 2026 data) =====
function renderMetrics() {
    const data = filteredDithwah;
    const total = data.length;
    const issued = data.filter(d => d.reportStatus === 'Issued').length;
    const inProgress = data.filter(d => d.reportStatus && d.reportStatus.toLowerCase().includes('prograss')).length;
    const approved = data.filter(d => d.approval === 'Approved' || d.approval === 'Approved with condition').length;
    const done = data.filter(d => d.workingStatus === 'Done').length;
    const withGps = data.filter(d => d.gps).length;

    document.getElementById('metric-total').textContent = total;
    document.getElementById('metric-issued').textContent = issued;
    document.getElementById('metric-progress').textContent = inProgress;
    document.getElementById('metric-approved').textContent = approved;
    document.getElementById('metric-done').textContent = done;
    document.getElementById('metric-gps').textContent = withGps;

    const pct = (n) => total ? Math.round((n / total) * 100) : 0;
    document.getElementById('metric-issued-pct').textContent = `${pct(issued)}% of total`;
    document.getElementById('metric-progress-pct').textContent = `${pct(inProgress)}% of total`;
    document.getElementById('metric-approved-pct').textContent = `${pct(approved)}% of total`;
    document.getElementById('metric-done-pct').textContent = `${pct(done)}% of total`;
    document.getElementById('metric-gps-pct').textContent = `${pct(withGps)}% of total`;
}

// ===== Charts =====
let chartInstances = {};

function destroyCharts() {
    Object.values(chartInstances).forEach(c => c.destroy());
    chartInstances = {};
}

function rebuildCharts() {
    destroyCharts();
    renderCharts();
}

function getChartFontColor() {
    const theme = document.documentElement.getAttribute('data-theme');
    return theme === 'light' ? '#536471' : '#8899a6';
}

function getGridColor() {
    const theme = document.documentElement.getAttribute('data-theme');
    return theme === 'light' ? '#e1e8ed' : '#2f3e4e';
}

function renderCharts() {
    destroyCharts();
    const fontColor = getChartFontColor();
    const gridColor = getGridColor();

    // 1. Report Status Distribution (Doughnut)
    const statusData = countBy(filteredDithwah, 'reportStatus');
    chartInstances.status = new Chart(document.getElementById('chart-status'), {
        type: 'doughnut',
        data: {
            labels: Object.keys(statusData),
            datasets: [{
                data: Object.values(statusData),
                backgroundColor: [COLORS.green, COLORS.blue, COLORS.red, COLORS.orange],
                borderWidth: 0,
                hoverOffset: 8,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '65%',
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { color: fontColor, padding: 16, usePointStyle: true, pointStyleWidth: 8 }
                }
            }
        }
    });

    // 2. Approval Status (Doughnut)
    const approvalData = countBy(filteredDithwah, 'approval');
    chartInstances.approval = new Chart(document.getElementById('chart-approval'), {
        type: 'doughnut',
        data: {
            labels: Object.keys(approvalData),
            datasets: [{
                data: Object.values(approvalData),
                backgroundColor: [COLORS.green, COLORS.orange, COLORS.red, COLORS.purple],
                borderWidth: 0,
                hoverOffset: 8,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '65%',
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { color: fontColor, padding: 16, usePointStyle: true, pointStyleWidth: 8 }
                }
            }
        }
    });

    // 3. District Bar Chart
    const distData = countBy(filteredDithwah, 'district');
    chartInstances.district = new Chart(document.getElementById('chart-district'), {
        type: 'bar',
        data: {
            labels: Object.keys(distData),
            datasets: [{
                label: 'Applications',
                data: Object.values(distData),
                backgroundColor: CHART_COLORS.slice(0, Object.keys(distData).length),
                borderRadius: 6,
                borderSkipped: false,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                x: { ticks: { color: fontColor }, grid: { display: false } },
                y: { ticks: { color: fontColor, stepSize: 1 }, grid: { color: gridColor } }
            }
        }
    });

    // 4. Working Status (Polar Area)
    const typeData = countBy(filteredDithwah, 'workingStatus');
    chartInstances.type = new Chart(document.getElementById('chart-type'), {
        type: 'polarArea',
        data: {
            labels: Object.keys(typeData),
            datasets: [{
                data: Object.values(typeData),
                backgroundColor: CHART_COLORS.map(c => c + '99'),
                borderColor: CHART_COLORS,
                borderWidth: 2,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { color: fontColor, padding: 12, usePointStyle: true, pointStyleWidth: 8 }
                }
            },
            scales: {
                r: {
                    ticks: { color: fontColor, backdropColor: 'transparent' },
                    grid: { color: gridColor }
                }
            }
        }
    });

    // 5. Monthly Request Timeline (Line)
    const monthlyData = {};
    filteredDithwah.forEach(d => {
        const dateStr = d.requestDate || d.issuedDate || '';
        if (dateStr) {
            try {
                const dt = new Date(dateStr);
                if (!isNaN(dt.getTime())) {
                    const key = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2, '0')}`;
                    monthlyData[key] = (monthlyData[key] || 0) + 1;
                }
            } catch(e) {}
        }
    });
    const sortedMonths = Object.keys(monthlyData).sort();
    const monthLabels = sortedMonths.map(m => {
        const [y, mo] = m.split('-');
        const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        return `${months[parseInt(mo)-1]} ${y}`;
    });

    chartInstances.timeline = new Chart(document.getElementById('chart-timeline'), {
        type: 'line',
        data: {
            labels: monthLabels,
            datasets: [{
                label: 'Reports Issued',
                data: sortedMonths.map(m => monthlyData[m]),
                borderColor: COLORS.blue,
                backgroundColor: COLORS.blue + '22',
                fill: true,
                tension: 0.4,
                pointRadius: 5,
                pointHoverRadius: 8,
                pointBackgroundColor: COLORS.blue,
                pointBorderColor: '#fff',
                pointBorderWidth: 2,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                x: { ticks: { color: fontColor }, grid: { color: gridColor } },
                y: {
                    beginAtZero: true,
                    ticks: { color: fontColor, stepSize: 1 },
                    grid: { color: gridColor }
                }
            }
        }
    });

    // 6. DSD Distribution (Horizontal Bar)
    const dsdData = countBy(filteredDithwah, 'dsd');
    const sortedDSD = Object.entries(dsdData).sort((a, b) => b[1] - a[1]);
    chartInstances.dsd = new Chart(document.getElementById('chart-dsd'), {
        type: 'bar',
        data: {
            labels: sortedDSD.map(e => e[0]),
            datasets: [{
                label: 'Applications',
                data: sortedDSD.map(e => e[1]),
                backgroundColor: COLORS.teal + 'cc',
                borderRadius: 6,
                borderSkipped: false,
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                x: { ticks: { color: fontColor, stepSize: 1 }, grid: { color: gridColor } },
                y: { ticks: { color: fontColor, font: { size: 11 } }, grid: { display: false } }
            }
        }
    });

    // 7. File Availability (Pie)
    const lssdTrue = filteredDithwah.filter(d => d.fileLink).length;
    const lssdFalse = filteredDithwah.filter(d => !d.fileLink).length;
    chartInstances.lssd = new Chart(document.getElementById('chart-lssd'), {
        type: 'pie',
        data: {
            labels: ['File Available', 'No File'],
            datasets: [{
                data: [lssdTrue, lssdFalse],
                backgroundColor: [COLORS.green + 'cc', COLORS.red + 'cc'],
                borderWidth: 0,
                hoverOffset: 6,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { color: fontColor, padding: 16, usePointStyle: true, pointStyleWidth: 8 }
                }
            }
        }
    });

    // 8. GND Distribution (Bar)
    const officerData = {};
    filteredDithwah.forEach(d => {
        const gnd = d.gnd?.trim();
        if (gnd) officerData[gnd] = (officerData[gnd] || 0) + 1;
    });
    const sortedGND = Object.entries(officerData).sort((a, b) => b[1] - a[1]).slice(0, 15);
    chartInstances.officer = new Chart(document.getElementById('chart-officer'), {
        type: 'bar',
        data: {
            labels: sortedGND.map(e => e[0]),
            datasets: [{
                label: 'Lands',
                data: sortedGND.map(e => e[1]),
                backgroundColor: COLORS.purple + 'cc',
                borderRadius: 6,
                borderSkipped: false,
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                x: { ticks: { color: fontColor, stepSize: 1 }, grid: { color: gridColor } },
                y: { ticks: { color: fontColor, font: { size: 11 } }, grid: { display: false } }
            }
        }
    });
}

function countBy(arr, key) {
    const counts = {};
    arr.forEach(item => {
        const val = item[key]?.trim();
        if (val) counts[val] = (counts[val] || 0) + 1;
    });
    return counts;
}

// ===== Data Table =====
function renderTable() {
    const tbody = document.getElementById('table-body');
    const searchInput = document.getElementById('table-search');

    let displayData = [...filteredData];

    // Search
    const query = searchInput ? searchInput.value.toLowerCase() : '';
    if (query) {
        displayData = displayData.filter(d =>
            (d.serial + ' ' + d.beneficiary + ' ' + d.district + ' ' + d.dsd + ' ' + d.status + ' ' + d.approval + ' ' + d.resettlementType)
                .toLowerCase().includes(query)
        );
    }

    // Sort
    if (sortCol) {
        displayData.sort((a, b) => {
            let va = a[sortCol] || '';
            let vb = b[sortCol] || '';
            if (!isNaN(va) && !isNaN(vb) && va !== '' && vb !== '') {
                va = parseFloat(va);
                vb = parseFloat(vb);
            }
            if (va < vb) return sortDir === 'asc' ? -1 : 1;
            if (va > vb) return sortDir === 'asc' ? 1 : -1;
            return 0;
        });
    }

    // Pagination
    const totalPages = Math.ceil(displayData.length / PAGE_SIZE);
    if (currentPage > totalPages) currentPage = totalPages || 1;
    const start = (currentPage - 1) * PAGE_SIZE;
    const pageData = displayData.slice(start, start + PAGE_SIZE);

    // Render rows
    // Security fix #6: Escape all user-controlled data to prevent DOM XSS
    tbody.innerHTML = pageData.map(d => `
        <tr>
            <td>${escHtml(d.serial)}</td>
            <td title="${escHtml(d.beneficiary)}">${escHtml(d.beneficiary)}</td>
            <td>${escHtml(d.district)}</td>
            <td>${escHtml(d.dsd)}</td>
            <td>${statusBadge(d.status)}</td>
            <td>${approvalBadge(d.approval)}</td>
            <td>${escHtml(d.resettlementType)}</td>
            <td>${escHtml(d.inspectionDate) || '-'}</td>
            <td>${escHtml(d.issuedDate) || '-'}</td>
            <td>${fileLink(d.report, d.reportLink)}</td>
            <td>${d.gps ? '\u{1F4CD}' : '-'}</td>
        </tr>
    `).join('');

    // Pagination controls
    document.getElementById('table-info').textContent =
        `Showing ${start + 1}-${Math.min(start + PAGE_SIZE, displayData.length)} of ${displayData.length}`;

    const pagination = document.getElementById('table-pagination');
    pagination.innerHTML = '';

    const prevBtn = document.createElement('button');
    prevBtn.textContent = '\u2190 Prev';
    prevBtn.disabled = currentPage <= 1;
    prevBtn.addEventListener('click', () => { currentPage--; renderTable(); });
    pagination.appendChild(prevBtn);

    for (let i = 1; i <= totalPages; i++) {
        const btn = document.createElement('button');
        btn.textContent = i;
        btn.className = i === currentPage ? 'active' : '';
        btn.addEventListener('click', () => { currentPage = i; renderTable(); });
        pagination.appendChild(btn);
    }

    const nextBtn = document.createElement('button');
    nextBtn.textContent = 'Next \u2192';
    nextBtn.disabled = currentPage >= totalPages;
    nextBtn.addEventListener('click', () => { currentPage++; renderTable(); });
    pagination.appendChild(nextBtn);
}

function statusBadge(status) {
    if (!status) return '-';
    const cls = status === 'Report Issued' ? 'badge-issued'
        : status === 'Inspected' ? 'badge-inspected'
        : 'badge-not-inspected';
    return `<span class="badge ${cls}">${escHtml(status)}</span>`;
}

function approvalBadge(approval) {
    if (!approval) return '-';
    const cls = approval === 'Approved' ? 'badge-approved'
        : approval === 'Rejected' ? 'badge-rejected'
        : 'badge-conditions';
    return `<span class="badge ${cls}">${escHtml(approval)}</span>`;
}

// Table sort
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.data-table thead th[data-sort]').forEach(th => {
        th.addEventListener('click', () => {
            const col = th.dataset.sort;
            if (sortCol === col) {
                sortDir = sortDir === 'asc' ? 'desc' : 'asc';
            } else {
                sortCol = col;
                sortDir = 'asc';
            }
            // Update sort icons
            document.querySelectorAll('.data-table thead th').forEach(t => {
                const icon = t.querySelector('.sort-icon');
                if (icon) icon.textContent = '';
            });
            const icon = th.querySelector('.sort-icon');
            if (icon) icon.textContent = sortDir === 'asc' ? '\u25B2' : '\u25BC';
            renderTable();
        });
    });
});

// Table search
document.addEventListener('DOMContentLoaded', () => {
    const searchInput = document.getElementById('table-search');
    if (searchInput) {
        searchInput.addEventListener('input', () => {
            currentPage = 1;
            renderTable();
        });
    }
});

// ===== Map =====
function initMap() {
    map = L.map('map', {
        zoomControl: true,
        scrollWheelZoom: true,
    }).setView([7.0, 80.8], 8);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 18,
    }).addTo(map);

    updateMapMarkers();

    setTimeout(() => map.invalidateSize(), 200);
}

function updateMapMarkers() {
    if (!map) return;

    // Clear existing
    markers.forEach(m => map.removeLayer(m));
    markers = [];

    const bounds = [];
    filteredDithwah.forEach(d => {
        if (d.gps) {
            const [lat, lng] = d.gps;
            const rs = d.reportStatus?.trim() || '';
            const ap = d.approval?.trim() || '';
            let color;
            if (rs === 'Issued') {
                // Sub-color by approval
                if (ap === 'Approved') color = COLORS.green;
                else if (ap === 'Approved with condition') color = COLORS.orange;
                else if (ap === 'Not Approved') color = COLORS.red;
                else color = COLORS.teal; // Issued but approval pending
            } else if (rs.toLowerCase().includes('prograss')) {
                color = COLORS.purple;
            } else if (rs === 'Not Issued') {
                color = COLORS.red;
            } else {
                color = COLORS.blue; // Pending
            }
            const marker = L.circleMarker([lat, lng], {
                radius: 8,
                fillColor: color,
                fillOpacity: 0.85,
                color: '#fff',
                weight: 2,
            }).addTo(map);

            // Security fix #6: Escape user data in map popups
            marker.bindPopup(`
                <div style="font-family:Inter,sans-serif;font-size:13px;line-height:1.5;">
                    <strong>#${escHtml(d.serial)}</strong> - ${escHtml(d.landName)}<br>
                    <b>District:</b> ${escHtml(d.district)} / ${escHtml(d.dsd)}<br>
                    <b>GND:</b> ${escHtml(d.gnd)}<br>
                    <b>Report:</b> ${escHtml(d.reportStatus) || 'Pending'}<br>
                    <b>Approval:</b> ${escHtml(d.approval) || 'Pending'}<br>
                    <b>Area:</b> ${escHtml(d.area) || '-'} acres
                </div>
            `);

            markers.push(marker);
            bounds.push([lat, lng]);
        }
    });

    if (bounds.length > 0) {
        map.fitBounds(bounds, { padding: [30, 30] });
    }
}

// ===== Export CSV =====
function exportCSV() {
    const headers = ['Serial', 'Beneficiary', 'District', 'DSD', 'Status', 'Approval', 'Type', 'Inspection Date', 'Issued Date', 'Report File', 'GPS'];
    const rows = filteredData.map(d => [
        d.serial, d.beneficiary, d.district, d.dsd, d.status, d.approval,
        d.resettlementType, d.inspectionDate, d.issuedDate, d.report, d.gpsRaw
    ]);

    let csv = headers.join(',') + '\n';
    rows.forEach(r => {
        csv += r.map(v => `"${(v || '').replace(/"/g, '""')}"`).join(',') + '\n';
    });

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'nbro_data_export.csv';
    a.click();
    URL.revokeObjectURL(url);
}

// ===== Dithwah 2026 =====
async function loadDithwahData() {
    try {
        const res = await fetch('/api/dithwah');
        dithwahData = await res.json();
        filteredDithwah = [...dithwahData];
    } catch (e) {
        console.error('Failed to load Dithwah data:', e);
    }
}

function setupRecordsTabs() {
    document.querySelectorAll('#records-tabs .tab-pill').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#records-tabs .tab-pill').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const tab = btn.dataset.tab;
            document.getElementById('tab-resettlement').style.display = tab === 'resettlement' ? '' : 'none';
            document.getElementById('tab-dithwah').style.display = tab === 'dithwah' ? '' : 'none';
            if (tab === 'dithwah') renderDithwahTable();
        });
    });

    // Dithwah search
    const dSearch = document.getElementById('dithwah-search');
    if (dSearch) {
        dSearch.addEventListener('input', () => {
            dCurrentPage = 1;
            renderDithwahTable();
        });
    }

    // Dithwah sort
    document.querySelectorAll('#dithwah-table thead th[data-dsort]').forEach(th => {
        th.addEventListener('click', () => {
            const col = th.dataset.dsort;
            if (dSortCol === col) {
                dSortDir = dSortDir === 'asc' ? 'desc' : 'asc';
            } else {
                dSortCol = col;
                dSortDir = 'asc';
            }
            document.querySelectorAll('#dithwah-table thead th').forEach(t => {
                const icon = t.querySelector('.sort-icon');
                if (icon) icon.textContent = '';
            });
            const icon = th.querySelector('.sort-icon');
            if (icon) icon.textContent = dSortDir === 'asc' ? '\u25B2' : '\u25BC';
            renderDithwahTable();
        });
    });
}

function renderDithwahTable() {
    const tbody = document.getElementById('dithwah-body');
    const searchInput = document.getElementById('dithwah-search');

    let displayData = [...filteredDithwah];

    // Search
    const query = searchInput ? searchInput.value.toLowerCase() : '';
    if (query) {
        displayData = displayData.filter(d =>
            (d.serial + ' ' + d.landName + ' ' + d.district + ' ' + d.dsd + ' ' + d.gnd + ' ' + d.reportStatus + ' ' + d.approval + ' ' + d.file)
                .toLowerCase().includes(query)
        );
    }

    // Sort
    if (dSortCol) {
        displayData.sort((a, b) => {
            let va = a[dSortCol] || '';
            let vb = b[dSortCol] || '';
            if (!isNaN(va) && !isNaN(vb) && va !== '' && vb !== '') {
                va = parseFloat(va);
                vb = parseFloat(vb);
            }
            if (va < vb) return dSortDir === 'asc' ? -1 : 1;
            if (va > vb) return dSortDir === 'asc' ? 1 : -1;
            return 0;
        });
    }

    // Pagination
    const totalPages = Math.ceil(displayData.length / PAGE_SIZE);
    if (dCurrentPage > totalPages) dCurrentPage = totalPages || 1;
    const start = (dCurrentPage - 1) * PAGE_SIZE;
    const pageData = displayData.slice(start, start + PAGE_SIZE);

    // Security fix #6: Escape all user-controlled data to prevent DOM XSS
    tbody.innerHTML = pageData.map(d => `
        <tr>
            <td>${escHtml(d.serial)}</td>
            <td title="${escHtml(d.landName)}">${escHtml(d.landName)}</td>
            <td>${escHtml(d.district)}</td>
            <td>${escHtml(d.dsd)}</td>
            <td>${escHtml(d.gnd)}</td>
            <td>${dithwahStatusBadge(d.reportStatus)}</td>
            <td>${approvalBadge(d.approval)}</td>
            <td>${escHtml(d.requestDate) || '-'}</td>
            <td>${escHtml(d.area) || '-'}</td>
            <td>${fileLink(d.file, d.fileLink)}</td>
            <td>${d.gps ? '\u{1F4CD}' : '-'}</td>
        </tr>
    `).join('');

    // Pagination controls
    document.getElementById('dithwah-info').textContent =
        `Showing ${displayData.length ? start + 1 : 0}-${Math.min(start + PAGE_SIZE, displayData.length)} of ${displayData.length}`;

    const pagination = document.getElementById('dithwah-pagination');
    pagination.innerHTML = '';

    const prevBtn = document.createElement('button');
    prevBtn.textContent = '\u2190 Prev';
    prevBtn.disabled = dCurrentPage <= 1;
    prevBtn.addEventListener('click', () => { dCurrentPage--; renderDithwahTable(); });
    pagination.appendChild(prevBtn);

    const maxButtons = 7;
    let startPage = Math.max(1, dCurrentPage - Math.floor(maxButtons / 2));
    let endPage = Math.min(totalPages, startPage + maxButtons - 1);
    if (endPage - startPage < maxButtons - 1) startPage = Math.max(1, endPage - maxButtons + 1);

    for (let i = startPage; i <= endPage; i++) {
        const btn = document.createElement('button');
        btn.textContent = i;
        btn.className = i === dCurrentPage ? 'active' : '';
        btn.addEventListener('click', () => { dCurrentPage = i; renderDithwahTable(); });
        pagination.appendChild(btn);
    }

    const nextBtn = document.createElement('button');
    nextBtn.textContent = 'Next \u2192';
    nextBtn.disabled = dCurrentPage >= totalPages;
    nextBtn.addEventListener('click', () => { dCurrentPage++; renderDithwahTable(); });
    pagination.appendChild(nextBtn);
}

function fileLink(fileName, url) {
    if (!fileName || !fileName.trim()) return '-';
    if (url && url.trim()) {
        return `<a href="${url}" target="_blank" rel="noopener" class="report-link" title="${escHtml(fileName)}">&#x1F4C4; ${escHtml(fileName)}</a>`;
    }
    return `<span class="report-link" style="opacity:0.5;cursor:default;" title="${escHtml(fileName)}">&#x1F4C4; ${escHtml(fileName)}</span>`;
}

function escHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function dithwahStatusBadge(status) {
    if (!status) return '-';
    const s = status.toLowerCase();
    const cls = s.includes('issued') ? 'badge-issued'
        : s.includes('done') ? 'badge-issued'
        : s.includes('pending') ? 'badge-conditions'
        : s.includes('not') ? 'badge-not-inspected'
        : 'badge-inspected';
    return `<span class="badge ${cls}">${escHtml(status)}</span>`;
}

function exportDithwahCSV() {
    const headers = ['#', 'Land Name', 'District', 'DSD', 'GND', 'Report Status', 'Approval', 'Request Date', 'Area', 'File', 'File Link', 'GPS'];
    const rows = filteredDithwah.map(d => [
        d.serial, d.landName, d.district, d.dsd, d.gnd, d.reportStatus, d.approval,
        d.requestDate, d.area, d.file, d.fileLink, d.gpsRaw
    ]);

    let csv = headers.join(',') + '\n';
    rows.forEach(r => {
        csv += r.map(v => `"${(v || '').replace(/"/g, '""')}"`).join(',') + '\n';
    });

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'dithwah_2026_export.csv';
    a.click();
    URL.revokeObjectURL(url);
}
