import streamlit as st
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
import folium
from streamlit_folium import folium_static
import requests as req
import csv
import io
import json
import urllib.parse
from html.parser import HTMLParser

# ── Page Config ──────────────────────────────────────────────────────
st.set_page_config(
    page_title="NBRI Resettlement",
    page_icon="🏠",
    layout="wide",
    initial_sidebar_state="expanded",
)

# ── Constants ────────────────────────────────────────────────────────
SPREADSHEET_ID = '10SXfXC4iaAPxgzVFdjDEhGDo8TB75Bhh_I9A3uCFXA0'
RESETTLEMENT_GID = '0'
DITHWAH_GID = '1129733636'

DISTRICT_MAP = {
    'BAD': 'Badulla', 'KDY': 'Kandy', 'GAL': 'Galle', 'KAL': 'Kalutara',
    'RAT': 'Ratnapura', 'MTL': 'Matale', 'KEG': 'Kegalle',
    'NUE': 'Nuwara Eliya', 'MAT': 'Matara',
}

COLORS = {
    'blue': '#1da1f2', 'green': '#17bf63', 'orange': '#ffad1f',
    'red': '#e0245e', 'purple': '#7856ff', 'teal': '#00d4aa',
    'pink': '#f91880', 'cyan': '#00bcd4',
}
CHART_COLORS = list(COLORS.values())


# ── Custom CSS ───────────────────────────────────────────────────────
st.markdown("""
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
html, body, [class*="st-"] { font-family: 'Inter', sans-serif; }

/* Hide default streamlit header/footer */
#MainMenu { visibility: hidden; }
header { visibility: hidden; }
footer { visibility: hidden; }

/* Reduce top padding */
.block-container { padding-top: 1rem; padding-bottom: 0; }

/* Metric card */
.metric-card {
    background: #1e2d3d;
    border: 1px solid #2f3e4e;
    border-radius: 12px;
    padding: 18px 14px;
    text-align: center;
    position: relative;
    overflow: hidden;
    transition: all 0.3s;
    min-height: 130px;
}
.metric-card:hover { transform: translateY(-2px); box-shadow: 0 8px 32px rgba(0,0,0,0.4); }
.metric-card .icon { font-size: 22px; margin-bottom: 6px; }
.metric-card .value { font-size: 30px; font-weight: 800; line-height: 1; margin: 6px 0; color: #e8edf2; }
.metric-card .label { font-size: 10px; color: #8899a6; text-transform: uppercase; letter-spacing: 1px; font-weight: 600; }
.metric-card .pct { font-size: 11px; color: #5b7083; margin-top: 6px; }
.metric-card::before {
    content: ''; position: absolute; top: 0; left: 0;
    width: 4px; height: 100%; border-radius: 4px 0 0 4px;
}
.mc-blue::before { background: #1da1f2; }
.mc-green::before { background: #17bf63; }
.mc-orange::before { background: #ffad1f; }
.mc-purple::before { background: #7856ff; }
.mc-red::before { background: #e0245e; }
.mc-teal::before { background: #00d4aa; }

/* Metrics row spacing */
.metrics-row { display: flex; gap: 12px; margin-bottom: 20px; }

/* Chart containers */
.chart-box {
    background: #1e2d3d;
    border: 1px solid #2f3e4e;
    border-radius: 12px;
    padding: 16px;
    margin-bottom: 16px;
}
.chart-box h4 { font-size: 14px; font-weight: 600; color: #e8edf2; margin: 0 0 12px 0; }

/* Legend */
.legend-row { display: flex; flex-wrap: wrap; gap: 14px; padding: 8px 0; font-size: 12px; color: #8899a6; }
.legend-item { display: flex; align-items: center; gap: 6px; }
.legend-dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }

/* Map container */
.map-box {
    background: #1e2d3d;
    border: 1px solid #2f3e4e;
    border-radius: 12px;
    overflow: hidden;
}
.map-header {
    padding: 14px 18px;
    border-bottom: 1px solid #2f3e4e;
    display: flex;
    justify-content: space-between;
    align-items: center;
}
.map-header h4 { margin: 0; font-size: 14px; font-weight: 600; color: #e8edf2; }
.map-header span { font-size: 12px; color: #5b7083; }

/* Progress bars */
.progress-container { margin-bottom: 14px; }
.progress-label { display: flex; justify-content: space-between; font-size: 13px; color: #8899a6; margin-bottom: 4px; }
.progress-bar-bg { height: 8px; background: #0f1923; border-radius: 4px; overflow: hidden; }
.progress-fill { height: 100%; border-radius: 4px; transition: width 1s ease; }

/* Section header */
.section-header { font-size: 13px; color: #5b7083; text-transform: uppercase; letter-spacing: 1.5px; font-weight: 600; margin-bottom: 16px; }

/* Streamlit overrides */
div[data-testid="stHorizontalBlock"] { gap: 12px; }
div[data-testid="column"] > div { padding: 0; }
.stTabs [data-baseweb="tab-list"] { gap: 8px; }
.stTabs [data-baseweb="tab"] {
    border-radius: 20px; padding: 6px 20px; font-size: 13px; font-weight: 600;
    background: transparent; border: 1px solid #2f3e4e; color: #8899a6;
}
.stTabs [aria-selected="true"] { background: #1da1f2 !important; color: white !important; border-color: #1da1f2 !important; }
</style>
""", unsafe_allow_html=True)


# ── GPS Parsing ──────────────────────────────────────────────────────
def parse_gps(coord):
    if not coord or not str(coord).strip():
        return None, None
    coord = str(coord).strip().replace('°', '')
    try:
        if ',' in coord and not any(c in coord.upper() for c in 'NSEW'):
            parts = coord.split(',')
            if len(parts) == 2:
                return float(parts[0].strip()), float(parts[1].strip())
        parts = coord.split()
        if len(parts) >= 2:
            lat = float(parts[0].rstrip('NSns'))
            if parts[0][-1].lower() == 's':
                lat = -lat
            lng = float(parts[1].rstrip('EWew'))
            if parts[1][-1].lower() == 'w':
                lng = -lng
            return lat, lng
    except (ValueError, IndexError):
        pass
    return None, None


# ── HTML Link Parser ─────────────────────────────────────────────────
class _LinkParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.in_table = self.in_tr = self.in_td = False
        self.current_link = None
        self.current_text = ''
        self.rows = []
        self.current_row = []

    def handle_starttag(self, tag, attrs):
        ad = dict(attrs)
        if tag == 'table': self.in_table = True
        elif tag == 'tr' and self.in_table: self.in_tr = True; self.current_row = []
        elif tag == 'td' and self.in_tr: self.in_td = True; self.current_link = None; self.current_text = ''
        elif tag == 'a' and self.in_td: self.current_link = ad.get('href', '')

    def handle_data(self, data):
        if self.in_td: self.current_text += data.strip()

    def handle_endtag(self, tag):
        if tag == 'td' and self.in_td:
            self.in_td = False
            self.current_row.append({'text': self.current_text.strip(), 'link': self.current_link})
        elif tag == 'tr' and self.in_tr:
            self.in_tr = False
            if self.current_row: self.rows.append(self.current_row)


def _clean_drive_link(raw):
    if not raw: return ''
    if 'google.com/url' in raw:
        parsed = urllib.parse.urlparse(raw)
        params = urllib.parse.parse_qs(parsed.query)
        raw = urllib.parse.unquote(params.get('q', [''])[0])
    if 'drive.google.com/file/d/' in raw:
        parts = raw.split('/file/d/')
        if len(parts) > 1:
            fid = parts[1].split('/')[0].split('?')[0]
            return f'https://drive.google.com/file/d/{fid}/view'
    return raw


# ── Data Fetching (cached) ───────────────────────────────────────────
@st.cache_data(ttl=120, show_spinner=False)
def fetch_csv(gid):
    url = f'https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}/gviz/tq?tqx=out:csv&gid={gid}'
    return req.get(url, timeout=15).text


@st.cache_data(ttl=300, show_spinner=False)
def fetch_links(gid, header_match, link_col):
    url = f'https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}/htmlview/sheet?headers=true&gid={gid}'
    resp = req.get(url, timeout=30)
    parser = _LinkParser()
    parser.feed(resp.text)
    header_row = None
    for i, row in enumerate(parser.rows):
        if header_match in [c['text'] for c in row]:
            header_row = i
            break
    if header_row is None: return {}
    headers = [c['text'] for c in parser.rows[header_row]]
    if link_col not in headers: return {}
    li = headers.index(link_col)
    result = {}
    for row in parser.rows[header_row + 1:]:
        if len(row) <= li: continue
        key = row[0]['text'].strip()
        if not key: continue
        text = row[li]['text'].strip()
        link = _clean_drive_link(row[li]['link'])
        if text: result[key] = {'name': text, 'link': link}
    return result


def load_dithwah():
    text = fetch_csv(DITHWAH_GID)
    links = fetch_links(DITHWAH_GID, 'File', 'File')
    reader = csv.DictReader(io.StringIO(text))
    records = []
    for r in reader:
        serial = (r.get(' ', r.get('', '')) or '').strip()
        if not serial: continue
        loc = r.get('Location', '')
        lat, lng = parse_gps(loc)
        dist = (r.get('District ', r.get('District', '')) or '').strip()
        link_info = links.get(serial, {})
        records.append({
            'Serial': serial, 'Ref': r.get('Ref. No.', ''),
            'Year': r.get('Year', ''), 'Issued Date': r.get('Issued Date', ''),
            'Land Name': r.get('Land Name', ''),
            'File': r.get('File', ''), 'File Link': link_info.get('link', ''),
            'District': DISTRICT_MAP.get(dist, dist),
            'Report Status': r.get('Status of Report', ''),
            'Request Date': r.get('Request Date', ''),
            'DSD': r.get('DSD', ''), 'GND': r.get('GND', ''),
            'lat': lat, 'lng': lng, 'GPS Raw': loc,
            'Area': r.get('Area (Acres)', ''),
            'Working Status': r.get('Working Status', ''),
            'Inspection Date': r.get('Inspection Date', ''),
            'Approval': r.get('Status of Approval', ''),
            'Remarks': (r.get('Remaks ', r.get('Remaks', '')) or ''),
        })
    return pd.DataFrame(records)


def load_resettlement():
    text = fetch_csv(RESETTLEMENT_GID)
    links = fetch_links(RESETTLEMENT_GID, 'Report', 'Report')
    reader = csv.DictReader(io.StringIO(text))
    records = []
    for r in reader:
        serial = (r.get('  Serial No.', r.get('Serial No.', '')) or '').strip()
        if not serial: continue
        lat, lng = parse_gps(r.get('GPS Coordinate', ''))
        dc = (r.get('Dist. Code', '') or '').strip()
        link_info = links.get(serial, {})
        records.append({
            'Serial': serial, 'Ref': r.get('Ref. No.', ''),
            'Beneficiary': r.get('Name of the Beneficiary', ''),
            'District': DISTRICT_MAP.get(dc, r.get('RS District', '')),
            'DSD': r.get('RS DSD', ''),
            'Status': r.get('Working Status', ''),
            'Approval': r.get('Approval Status', ''),
            'Type': r.get('Resettlement Type', ''),
            'Inspection Date': r.get('Site Inspection Date', ''),
            'Issued Date': r.get('Report Issued Date', ''),
            'Report': r.get('Report', ''), 'Report Link': link_info.get('link', ''),
            'lat': lat, 'lng': lng, 'GPS Raw': r.get('GPS Coordinate', ''),
        })
    return pd.DataFrame(records)


# ── Load Data ────────────────────────────────────────────────────────
with st.spinner('Loading live data from Google Sheets...'):
    dithwah_df = load_dithwah()
    resettlement_df = load_resettlement()


# ── Sidebar ──────────────────────────────────────────────────────────
with st.sidebar:
    st.markdown("### 🏠 NBRI Resettlement")
    st.caption("Progress Dashboard")
    st.divider()

    nav = st.radio("Navigation", ["Overview", "Analytics", "Records"], label_visibility="collapsed")
    st.divider()

    st.markdown("##### Filters")
    districts = ['All'] + sorted(dithwah_df['District'].dropna().unique().tolist())
    sel_district = st.selectbox("District", districts)

    # Cascading DSD filter
    if sel_district != 'All':
        dsd_options = sorted(dithwah_df[dithwah_df['District'] == sel_district]['DSD'].dropna().unique().tolist())
    else:
        dsd_options = sorted(dithwah_df['DSD'].dropna().unique().tolist())
    dsds = ['All'] + dsd_options
    sel_dsd = st.selectbox("DSD Division", dsds)

    statuses = ['All'] + sorted(dithwah_df['Report Status'].dropna().unique().tolist())
    sel_status = st.selectbox("Report Status", statuses)

    approvals = ['All'] + sorted(dithwah_df['Approval'].dropna().unique().tolist())
    sel_approval = st.selectbox("Approval", approvals)

    if st.button("Reset Filters", use_container_width=True):
        st.rerun()

    st.divider()
    if st.button("🔄 Refresh Data", use_container_width=True):
        st.cache_data.clear()
        st.rerun()

    st.divider()
    st.caption("NBRI - HSPTD Division\nNLRP Site Investigation Unit")


# ── Apply Filters ────────────────────────────────────────────────────
fdf = dithwah_df.copy()
if sel_district != 'All':
    fdf = fdf[fdf['District'] == sel_district]
if sel_dsd != 'All':
    fdf = fdf[fdf['DSD'] == sel_dsd]
if sel_status != 'All':
    fdf = fdf[fdf['Report Status'] == sel_status]
if sel_approval != 'All':
    fdf = fdf[fdf['Approval'] == sel_approval]


# ── Helper: Metric Card HTML ────────────────────────────────────────
def metric_card(icon, value, label, pct, color_class):
    return f"""
    <div class="metric-card {color_class}">
        <div class="icon">{icon}</div>
        <div class="value">{value}</div>
        <div class="label">{label}</div>
        <div class="pct">{pct}% of total</div>
    </div>
    """


# ── Helper: Map marker color ────────────────────────────────────────
def get_marker_color(row):
    rs = str(row.get('Report Status', '')).strip()
    ap = str(row.get('Approval', '')).strip()
    if rs == 'Issued':
        if ap == 'Approved': return '#17bf63'
        if ap == 'Approved with condition': return '#ffad1f'
        if ap == 'Not Approved': return '#e0245e'
        return '#00d4aa'
    if 'prograss' in rs.lower(): return '#7856ff'
    if rs == 'Not Issued': return '#e0245e'
    return '#1da1f2'


# ══════════════════════════════════════════════════════════════════════
# OVERVIEW
# ══════════════════════════════════════════════════════════════════════
if nav == "Overview":
    total = len(fdf)
    issued = len(fdf[fdf['Report Status'] == 'Issued'])
    progress = len(fdf[fdf['Report Status'].str.lower().str.contains('prograss', na=False)])
    approved = len(fdf[fdf['Approval'].isin(['Approved', 'Approved with condition'])])
    done = len(fdf[fdf['Working Status'] == 'Done'])
    gps_count = int(fdf['lat'].notna().sum())
    pct = lambda n: round(n / total * 100) if total else 0

    # Title
    st.markdown('<div class="section-header">Overview</div>', unsafe_allow_html=True)

    # Metric tiles
    cols = st.columns(6, gap="small")
    cards_data = [
        ("📄", total, "Total Lands", 100, "mc-blue"),
        ("✅", issued, "Reports Issued", pct(issued), "mc-green"),
        ("🔄", progress, "In Progress", pct(progress), "mc-orange"),
        ("🎯", approved, "Approved", pct(approved), "mc-purple"),
        ("☑️", done, "Work Done", pct(done), "mc-red"),
        ("📍", gps_count, "GPS Mapped", pct(gps_count), "mc-teal"),
    ]
    for col, (icon, val, lbl, p, cls) in zip(cols, cards_data):
        col.markdown(metric_card(icon, val, lbl, p, cls), unsafe_allow_html=True)

    st.markdown("<br>", unsafe_allow_html=True)

    # Hero: Charts + Map
    left, right = st.columns([1, 1.6], gap="medium")

    with left:
        # Report Status Doughnut
        rs_counts = fdf['Report Status'].value_counts().reset_index()
        rs_counts.columns = ['Status', 'Count']
        if not rs_counts.empty:
            fig1 = px.pie(rs_counts, values='Count', names='Status', hole=0.65,
                          color_discrete_sequence=[COLORS['green'], COLORS['orange'], COLORS['red'], COLORS['blue']])
            fig1.update_layout(
                title=dict(text="Report Status Distribution", font=dict(size=14, color='#e8edf2')),
                margin=dict(t=40, b=10, l=10, r=10), height=270,
                paper_bgcolor='rgba(0,0,0,0)', plot_bgcolor='rgba(0,0,0,0)',
                font_color='#8899a6', legend=dict(font=dict(size=11)))
            st.plotly_chart(fig1, use_container_width=True)

        # Approval Doughnut
        ap_counts = fdf['Approval'].value_counts().reset_index()
        ap_counts.columns = ['Approval', 'Count']
        if not ap_counts.empty:
            fig2 = px.pie(ap_counts, values='Count', names='Approval', hole=0.65,
                          color_discrete_sequence=[COLORS['green'], COLORS['orange'], COLORS['red'], COLORS['purple']])
            fig2.update_layout(
                title=dict(text="Approval Status", font=dict(size=14, color='#e8edf2')),
                margin=dict(t=40, b=10, l=10, r=10), height=270,
                paper_bgcolor='rgba(0,0,0,0)', plot_bgcolor='rgba(0,0,0,0)',
                font_color='#8899a6', legend=dict(font=dict(size=11)))
            st.plotly_chart(fig2, use_container_width=True)

    with right:
        # Map with styled container
        map_df = fdf[fdf['lat'].notna() & fdf['lng'].notna()]
        st.markdown(f"""
        <div class="map-box">
            <div class="map-header">
                <h4>🗺️ Site Locations - Sri Lanka</h4>
                <span>{len(map_df)} locations mapped</span>
            </div>
        </div>
        """, unsafe_allow_html=True)

        m = folium.Map(location=[7.0, 80.8], zoom_start=8, tiles='OpenStreetMap')
        for _, row in map_df.iterrows():
            color = get_marker_color(row)
            folium.CircleMarker(
                location=[row['lat'], row['lng']],
                radius=7, fill=True, fill_color=color, fill_opacity=0.85,
                color='white', weight=2,
                popup=folium.Popup(
                    f"<b>#{row['Serial']}</b> - {row['Land Name']}<br>"
                    f"<b>District:</b> {row['District']} / {row['DSD']}<br>"
                    f"<b>GND:</b> {row['GND']}<br>"
                    f"<b>Report:</b> {row['Report Status'] or 'Pending'}<br>"
                    f"<b>Approval:</b> {row['Approval'] or 'Pending'}<br>"
                    f"<b>Area:</b> {row['Area'] or '-'} acres",
                    max_width=250),
            ).add_to(m)
        folium_static(m, height=520)

        st.markdown("""
        <div class="legend-row">
            <div class="legend-item"><span class="legend-dot" style="background:#17bf63;"></span> Issued - Approved</div>
            <div class="legend-item"><span class="legend-dot" style="background:#ffad1f;"></span> Issued - Conditions</div>
            <div class="legend-item"><span class="legend-dot" style="background:#00d4aa;"></span> Issued - Pending</div>
            <div class="legend-item"><span class="legend-dot" style="background:#e0245e;"></span> Not Approved</div>
            <div class="legend-item"><span class="legend-dot" style="background:#7856ff;"></span> In Progress</div>
            <div class="legend-item"><span class="legend-dot" style="background:#1da1f2;"></span> Pending</div>
        </div>
        """, unsafe_allow_html=True)

    st.markdown("<br>", unsafe_allow_html=True)

    # Charts Row 2
    c1, c2 = st.columns(2, gap="medium")
    with c1:
        dist_counts = fdf['District'].value_counts().reset_index()
        dist_counts.columns = ['District', 'Count']
        if not dist_counts.empty:
            fig3 = px.bar(dist_counts, x='District', y='Count', color='District',
                          color_discrete_sequence=CHART_COLORS)
            fig3.update_layout(
                title=dict(text="Applications by District", font=dict(size=14, color='#e8edf2')),
                showlegend=False, margin=dict(t=40, b=0), height=300,
                paper_bgcolor='rgba(0,0,0,0)', plot_bgcolor='rgba(0,0,0,0)',
                font_color='#8899a6', xaxis=dict(gridcolor='#2f3e4e'),
                yaxis=dict(gridcolor='#2f3e4e'))
            fig3.update_traces(marker_cornerradius=6)
            st.plotly_chart(fig3, use_container_width=True)

    with c2:
        ws_counts = fdf['Working Status'].value_counts().reset_index()
        ws_counts.columns = ['Status', 'Count']
        if not ws_counts.empty:
            fig4 = px.pie(ws_counts, values='Count', names='Status',
                          color_discrete_sequence=CHART_COLORS)
            fig4.update_layout(
                title=dict(text="Working Status", font=dict(size=14, color='#e8edf2')),
                margin=dict(t=40, b=10, l=10, r=10), height=300,
                paper_bgcolor='rgba(0,0,0,0)', plot_bgcolor='rgba(0,0,0,0)',
                font_color='#8899a6', legend=dict(font=dict(size=11)))
            st.plotly_chart(fig4, use_container_width=True)

    # Timeline
    dates = fdf['Request Date'].dropna()
    dates = dates[dates.str.strip() != '']
    if not dates.empty:
        parsed = pd.to_datetime(dates, errors='coerce').dropna()
        if not parsed.empty:
            monthly = parsed.dt.to_period('M').value_counts().sort_index()
            monthly_df = pd.DataFrame({'Month': monthly.index.astype(str), 'Count': monthly.values})
            fig5 = px.area(monthly_df, x='Month', y='Count',
                           color_discrete_sequence=[COLORS['blue']])
            fig5.update_layout(
                title=dict(text="Monthly Requests Timeline", font=dict(size=14, color='#e8edf2')),
                margin=dict(t=40, b=0), height=280,
                paper_bgcolor='rgba(0,0,0,0)', plot_bgcolor='rgba(0,0,0,0)',
                font_color='#8899a6', xaxis=dict(gridcolor='#2f3e4e'),
                yaxis=dict(gridcolor='#2f3e4e'))
            fig5.update_traces(line_shape='spline')
            st.plotly_chart(fig5, use_container_width=True)


# ══════════════════════════════════════════════════════════════════════
# ANALYTICS
# ══════════════════════════════════════════════════════════════════════
elif nav == "Analytics":
    st.markdown('<div class="section-header">Analytics</div>', unsafe_allow_html=True)

    c1, c2 = st.columns(2, gap="medium")
    with c1:
        dsd_counts = fdf['DSD'].value_counts().head(20).sort_values()
        if not dsd_counts.empty:
            fig = px.bar(dsd_counts, orientation='h', color_discrete_sequence=[COLORS['teal']])
            fig.update_layout(
                title=dict(text="Applications by DSD Division", font=dict(size=14, color='#e8edf2')),
                showlegend=False, margin=dict(t=40, l=0, r=0, b=0), height=400,
                paper_bgcolor='rgba(0,0,0,0)', plot_bgcolor='rgba(0,0,0,0)',
                font_color='#8899a6', yaxis_title='', xaxis_title='',
                xaxis=dict(gridcolor='#2f3e4e'), yaxis=dict(gridcolor='#2f3e4e'))
            fig.update_traces(marker_cornerradius=6)
            st.plotly_chart(fig, use_container_width=True)

    with c2:
        has_file = int(fdf['File Link'].apply(lambda x: bool(x and str(x).strip())).sum())
        no_file = len(fdf) - has_file
        fig = px.pie(values=[has_file, no_file], names=['File Available', 'No File'],
                     color_discrete_sequence=[COLORS['green'], COLORS['red']])
        fig.update_layout(
            title=dict(text="File Availability", font=dict(size=14, color='#e8edf2')),
            margin=dict(t=40, b=10, l=10, r=10), height=400,
            paper_bgcolor='rgba(0,0,0,0)', plot_bgcolor='rgba(0,0,0,0)',
            font_color='#8899a6', legend=dict(font=dict(size=11)))
        st.plotly_chart(fig, use_container_width=True)

    gnd_counts = fdf['GND'].value_counts().head(15).sort_values()
    if not gnd_counts.empty:
        fig = px.bar(gnd_counts, orientation='h', color_discrete_sequence=[COLORS['purple']])
        fig.update_layout(
            title=dict(text="Top GND Divisions", font=dict(size=14, color='#e8edf2')),
            showlegend=False, margin=dict(t=40, l=0, r=0, b=0), height=350,
            paper_bgcolor='rgba(0,0,0,0)', plot_bgcolor='rgba(0,0,0,0)',
            font_color='#8899a6', yaxis_title='', xaxis_title='',
            xaxis=dict(gridcolor='#2f3e4e'), yaxis=dict(gridcolor='#2f3e4e'))
        fig.update_traces(marker_cornerradius=6)
        st.plotly_chart(fig, use_container_width=True)

    # Progress Summary with custom bars
    st.markdown('<div class="section-header" style="margin-top:20px;">Process Completion Summary</div>', unsafe_allow_html=True)
    total = len(fdf)
    if total:
        metrics = [
            ("Reports Issued", int(len(fdf[fdf['Report Status'] == 'Issued'])), COLORS['green']),
            ("Work Done", int(len(fdf[fdf['Working Status'] == 'Done'])), COLORS['blue']),
            ("GPS Coordinates", int(fdf['lat'].notna().sum()), COLORS['teal']),
            ("Files Available", int(fdf['File Link'].apply(lambda x: bool(x and str(x).strip())).sum()), COLORS['purple']),
            ("Approved", int(len(fdf[fdf['Approval'].isin(['Approved', 'Approved with condition'])])), COLORS['orange']),
        ]
        progress_html = ""
        for label, count, color in metrics:
            p = round(count / total * 100)
            progress_html += f"""
            <div class="progress-container">
                <div class="progress-label"><span>{label}</span><span>{count}/{total} ({p}%)</span></div>
                <div class="progress-bar-bg"><div class="progress-fill" style="width:{p}%;background:{color};"></div></div>
            </div>"""
        st.markdown(progress_html, unsafe_allow_html=True)


# ══════════════════════════════════════════════════════════════════════
# RECORDS
# ══════════════════════════════════════════════════════════════════════
elif nav == "Records":
    st.markdown('<div class="section-header">Records</div>', unsafe_allow_html=True)
    tab1, tab2 = st.tabs(["📋 Dithwah 2026", "📋 Resettlement"])

    with tab1:
        st.markdown("##### 📋 Dithwah 2026 Records")
        search = st.text_input("Search records...", key="dithwah_search")
        display_df = fdf.copy()
        if search:
            mask = display_df.apply(lambda r: search.lower() in ' '.join(r.astype(str)).lower(), axis=1)
            display_df = display_df[mask]

        show_cols = ['Serial', 'Land Name', 'District', 'DSD', 'GND', 'Report Status',
                     'Approval', 'Request Date', 'Area', 'File', 'File Link']
        show_df = display_df[show_cols].copy()

        col_config = {
            "File Link": st.column_config.LinkColumn("File", display_text="📄 Open"),
        }
        st.dataframe(show_df, column_config=col_config, use_container_width=True, height=500, hide_index=True)

        csv_data = show_df.to_csv(index=False).encode('utf-8')
        st.download_button("⬇ Export CSV", csv_data, "dithwah_2026_export.csv", "text/csv")
        st.caption(f"{len(display_df)} records")

    with tab2:
        st.markdown("##### 📋 Resettlement Records")
        search2 = st.text_input("Search records...", key="res_search")
        res_display = resettlement_df.copy()
        if search2:
            mask = res_display.apply(lambda r: search2.lower() in ' '.join(r.astype(str)).lower(), axis=1)
            res_display = res_display[mask]

        show_cols2 = ['Serial', 'Beneficiary', 'District', 'DSD', 'Status', 'Approval',
                      'Type', 'Inspection Date', 'Issued Date', 'Report', 'Report Link']
        show_df2 = res_display[show_cols2].copy()

        col_config2 = {
            "Report Link": st.column_config.LinkColumn("Report", display_text="📄 Open"),
        }
        st.dataframe(show_df2, column_config=col_config2, use_container_width=True, height=500, hide_index=True)

        csv_data2 = show_df2.to_csv(index=False).encode('utf-8')
        st.download_button("⬇ Export CSV", csv_data2, "resettlement_export.csv", "text/csv")
        st.caption(f"{len(res_display)} records")
