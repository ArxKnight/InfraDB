import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import SiteMapIndexPage from '../../pages/SiteMapIndexPage';
import { apiClient } from '../../lib/api';

const routerFuture = {
  v7_startTransition: true,
  v7_relativeSplatPath: true,
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/sites/1/mapindex']} future={routerFuture}>
      <Routes>
        <Route path="/sites/:siteId/mapindex" element={<SiteMapIndexPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('SiteMapIndexPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    (apiClient.getSite as any).mockResolvedValue({
      success: true,
      data: { site: { id: 1, name: 'Test Site', code: 'TS' } },
    });

    (apiClient as any).getSiteRacks = vi.fn().mockResolvedValue({
      success: true,
      data: {
        racks: [
          { id: 101, rackLocation: 'WAL/FL0/S1/ROWA/R1', rackSizeU: 42 },
          { id: 102, rackLocation: 'WAL/FL0/S1/ROWA/R2', rackSizeU: 42 },
        ],
      },
    });

    (apiClient as any).getSiteRackElevation = vi.fn().mockResolvedValue({
      success: true,
      data: {
        racks: [
          {
            rackId: 101,
            rackLocation: 'WAL/FL0/S1/ROWA/R1',
            rackSizeU: 42,
            occupants: [
              { uPosition: 22, sidId: 1, sidNumber: '1', hostname: 'WAL-SW1' },
              { uPosition: 30, rackUnits: 2, sidId: 3, sidNumber: '3', hostname: 'WAL-Media1' },
              { uPosition: 1, sidId: 6, sidNumber: '6', hostname: 'WAL-PDU' },
            ],
          },
        ],
      },
    });

    (apiClient as any).getSiteCableTrace = vi.fn().mockResolvedValue({
      success: true,
      data: {
        cableRef: '#0001',
        labelId: 1,
        hops: [
          {
            hostname: 'WAL-SW1',
            sidId: 1,
            manufacturer: 'Ubiquiti',
            modelName: 'USW-24-POE (95W)',
            rackLocation: 'WAL/FL0/S1/ROWA/R1',
            rackU: 22,
            rackUText: '22',
            rackUnits: 1,
            portLabel: 'Port 3',
            nicType: 'RJ45',
          },
          {
            hostname: 'WAL-PP1',
            sidId: 3,
            manufacturer: 'Molex',
            modelName: 'PowerCat',
            rackLocation: 'WAL/FL0/S1/ROWA/R1',
            rackU: 21,
            rackUText: '21',
            rackUnits: 1,
            portLabel: 'Port 1',
            nicType: null,
          },
          {
            hostname: 'WAL-PP2',
            sidId: 4,
            manufacturer: 'Molex',
            modelName: 'PowerCat',
            rackLocation: 'WAL/FL0/S1/ROWA/R2',
            rackU: 20,
            rackUText: '20',
            rackUnits: 1,
            portLabel: 'Port 2',
            nicType: null,
          },
          {
            hostname: 'WAL-SW2',
            sidId: 5,
            manufacturer: 'Ubiquiti',
            modelName: 'USW-24-POE (95W)',
            rackLocation: 'WAL/FL0/S1/ROWA/R2',
            rackU: 22,
            rackUText: '22',
            rackUnits: 1,
            portLabel: 'Port 9',
            nicType: 'RJ45',
          },
        ],
      },
    });

    (apiClient as any).downloadSiteCableReport = vi.fn().mockResolvedValue({
      blob: new Blob(['test'], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }),
      filename: 'TEST_site_overview_report.docx',
    });

    (apiClient as any).getSiteSids = vi.fn().mockResolvedValue({
      success: true,
      data: {
        sids: [
          {
            id: 1,
            sid_number: '1',
            hostname: 'WAL-SW1',
            status: 'Active',
            location_path: 'WAL/FL0/S1/ROWA/R1',
            primary_ip: '10.0.0.1',
          },
        ],
        pagination: { has_more: false },
      },
    });

    (apiClient as any).downloadSiteSidIndexReport = vi.fn().mockResolvedValue({
      blob: new Blob(['sid'], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }),
      filename: 'TEST_sid_index_report.docx',
    });

    (apiClient as any).downloadSiteCableTraceReport = vi.fn().mockResolvedValue({
      blob: new Blob(['trace'], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }),
      filename: 'TEST_cable_trace_report.docx',
    });

    (apiClient as any).downloadSiteVisualRackReport = vi.fn().mockResolvedValue({
      blob: new Blob(['rack'], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }),
      filename: 'TEST_visual_rack_report.docx',
    });
  });

  it('renders MapIndex tabs and rack empty-state message', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Test Site' })).toBeInTheDocument();
    });

    expect(screen.getByText('MAPIndex')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Rack View' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Cable Trace' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Reports' })).toBeInTheDocument();
    expect(screen.getByText('Select rack locations to view rack/s visually')).toBeInTheDocument();
  });

  it('loads reports tab actions', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('tab', { name: 'Reports' }));

    expect(screen.getByText('Site Overview Report')).toBeInTheDocument();
    expect(screen.getByText('SID Index Report')).toBeInTheDocument();
    expect(screen.getByText('Cable Trace Report')).toBeInTheDocument();
    expect(screen.getByText('Visual Rack Report')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Download Site Overview Report (.docx)' }));
    await waitFor(() => {
      expect((apiClient as any).downloadSiteCableReport).toHaveBeenCalledWith(1);
    });

    await user.click(screen.getByRole('button', { name: 'Download SID Index Report (.docx)' }));
    await waitFor(() => {
      expect((apiClient as any).downloadSiteSidIndexReport).toHaveBeenCalledWith(1);
    });

    await user.type(screen.getByPlaceholderText('Enter one or more refs (comma or new line): #0001, #0002'), '#0001, #0002');
    await user.click(screen.getByRole('button', { name: 'Download Trace Report (.docx)' }));
    await waitFor(() => {
      expect((apiClient as any).downloadSiteCableTraceReport).toHaveBeenCalled();
    });

    const checkboxes = await screen.findAllByRole('checkbox');
    await user.click(checkboxes[0]!);
    await user.click(screen.getByRole('button', { name: 'Download Visual Rack Report (.docx)' }));
    await waitFor(() => {
      expect((apiClient as any).downloadSiteVisualRackReport).toHaveBeenCalled();
    });
  });

  it('loads selected rack elevations and shows occupants', async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => {
      expect((apiClient as any).getSiteRacks).toHaveBeenCalled();
    });

    const checkboxes = await screen.findAllByRole('checkbox');
    const checkbox = checkboxes[0]!;
    await user.click(checkbox);
    await user.click(screen.getByRole('button', { name: 'Load' }));

    await waitFor(() => {
      expect((apiClient as any).getSiteRackElevation).toHaveBeenCalledWith(1, [101]);
    });

    expect(screen.getByText('Rack - WAL/FL0/S1/ROWA/R1')).toBeInTheDocument();
    expect(screen.getByText('WAL-SW1 (SID: 1)')).toBeInTheDocument();
    expect(screen.getAllByText('WAL-Media1 (SID: 3)')).toHaveLength(1);
    expect(screen.getByText('WAL-PDU (SID: 6)')).toBeInTheDocument();
  });

  it('runs cable trace and renders hop blocks', async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Cable Trace' })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('tab', { name: 'Cable Trace' }));
    await user.type(screen.getByPlaceholderText('e.g. #0001'), '#0001');
    await user.click(screen.getByRole('button', { name: 'Trace' }));

    await waitFor(() => {
      expect((apiClient as any).getSiteCableTrace).toHaveBeenCalledWith(1, '#0001');
    });

    expect(screen.getByText('Cable Trace Ref #0001')).toBeInTheDocument();
    expect(screen.getByText('Source')).toBeInTheDocument();
    expect(screen.getByText('Destination')).toBeInTheDocument();
    expect(screen.getByText(/WAL-SW1/)).toBeInTheDocument();
    expect(screen.getByText(/WAL-PP1/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Cable Ref#' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Source SID' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Destination SID' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Source Patch Panel SID' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Destination Patch Panel SID' })).toBeInTheDocument();
  });

  it('renders unknown placeholders when cable endpoints are not linked to SIDs', async () => {
    const user = userEvent.setup();

    (apiClient as any).getSiteCableTrace = vi.fn().mockResolvedValue({
      success: true,
      data: {
        cableRef: '#0001',
        labelId: 1,
        hops: [
          {
            hostname: 'Unknown',
            sidId: null,
            manufacturer: null,
            modelName: null,
            rackLocation: 'WAL/FL0/S1/ROWA/R1',
            rackU: null,
            rackUText: null,
            rackUnits: null,
            portLabel: null,
            nicType: null,
          },
          {
            hostname: 'Unknown',
            sidId: null,
            manufacturer: null,
            modelName: null,
            rackLocation: 'WAL/FL0/S1/ROWA/R2',
            rackU: null,
            rackUText: null,
            rackUnits: null,
            portLabel: null,
            nicType: null,
          },
        ],
      },
    });

    renderPage();

    await user.click(await screen.findByRole('tab', { name: 'Cable Trace' }));
    await user.type(screen.getByPlaceholderText('e.g. #0001'), '#0001');
    await user.click(screen.getByRole('button', { name: 'Trace' }));

    await waitFor(() => {
      expect((apiClient as any).getSiteCableTrace).toHaveBeenCalledWith(1, '#0001');
    });

    expect(screen.getAllByText('Unknown (SID: Unknown)')).toHaveLength(2);
    expect(screen.getAllByText('Unknown - Unknown | (Unknown)')).toHaveLength(2);
    expect(screen.getAllByText('Connected Port: Unknown')).toHaveLength(2);
  });
});
