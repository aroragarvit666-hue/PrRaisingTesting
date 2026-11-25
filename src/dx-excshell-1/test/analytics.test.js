/*
* <license header>
*/

jest.mock('@adobe/aio-sdk', () => ({
  Core: { Logger: jest.fn(() => ({ info: jest.fn(), debug: jest.fn(), error: jest.fn() })) }
}))
jest.mock('@adobe/aio-lib-core-auth', () => ({ generateAccessToken: jest.fn() }))
jest.mock('@adobe/aio-lib-analytics', () => ({ init: jest.fn() }))

const { generateAccessToken } = require('@adobe/aio-lib-core-auth')
const sdk = require('@adobe/aio-lib-analytics')
const { main, buildDateRange } = require('../actions/analytics/index.js')

const mockClient = { getCollections: jest.fn(), getReport: jest.fn() }
const baseParams = { apiKey: 'fake-key', __ims_oauth_s2s: { client_id: 'x' } }

beforeEach(() => {
  jest.clearAllMocks()
  generateAccessToken.mockResolvedValue({ access_token: 'fake-token' })
  sdk.init.mockResolvedValue(mockClient)
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ imsOrgs: [{ companies: [{ globalCompanyId: 'acme1' }] }] })
  })
})

describe('analytics', () => {
  test('returns 400 when apiKey is missing', async () => {
    const res = await main({})
    expect(res.statusCode).toBe(400)
    expect(res.body.error).toContain('Missing')
  })

  test('returns 400 on an invalid range', async () => {
    const res = await main({ ...baseParams, rsid: 'rs1', range: '12d' })
    expect(res.statusCode).toBe(400)
    expect(res.body.error).toContain('Invalid range')
  })

  test('lists report suites when no rsid is given', async () => {
    mockClient.getCollections.mockResolvedValue({ body: { content: [{ rsid: 'rs1', name: 'Main Site' }, { rsid: 'rs2' }] } })
    const res = await main(baseParams)
    expect(sdk.init).toHaveBeenCalledWith('acme1', 'fake-key', 'fake-token')
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ reportSuites: [{ rsid: 'rs1', name: 'Main Site' }, { rsid: 'rs2', name: 'rs2' }] })
  })

  test('returns totals, daily rows and top pages for a report', async () => {
    mockClient.getReport
      .mockResolvedValueOnce({ body: { rows: [{ itemId: 'd1', value: 'Nov 1, 2026', data: [10, 5, 4, 0.5] }], summaryData: { totals: [10, 5, 4, 0.5] } } })
      .mockResolvedValueOnce({ body: { rows: [{ itemId: 'p1', value: 'home', data: [7, 3, 2, 0.25] }] } })
    const res = await main({ ...baseParams, rsid: 'rs1', range: '7d' })
    expect(res.statusCode).toBe(200)
    expect(res.body.totals).toEqual({ pageviews: 10, visits: 5, visitors: 4, bouncerate: 0.5 })
    expect(res.body.daily).toEqual([{ id: 'd1', label: 'Nov 1, 2026', pageviews: 10, visits: 5, visitors: 4, bouncerate: 0.5 }])
    expect(res.body.topPages[0].label).toBe('home')
    const dailyBody = mockClient.getReport.mock.calls[0][0]
    expect(dailyBody.rsid).toBe('rs1')
    expect(dailyBody.dimension).toBe('variables/daterangeday')
    expect(mockClient.getReport.mock.calls[1][0].dimension).toBe('variables/page')
  })

  test('maps SDK permission errors to 403', async () => {
    mockClient.getReport.mockRejectedValue(new Error('[AnalyticsAPISDK:ERROR_GET_REPORT] 403 - Forbidden'))
    const res = await main({ ...baseParams, rsid: 'rs1', range: '30d' })
    expect(res.statusCode).toBe(403)
    expect(res.body.error).toContain('Forbidden')
  })

  test('returns 500 on unexpected SDK failure', async () => {
    generateAccessToken.mockRejectedValue(new Error('boom'))
    const res = await main(baseParams)
    expect(res.statusCode).toBe(500)
    expect(res.body).toEqual({ error: 'boom' })
  })

  test('buildDateRange covers the last N full days', () => {
    const r = buildDateRange(7, new Date('2026-11-24T15:00:00Z'))
    expect(r).toEqual({ startDate: '2026-11-17', endDate: '2026-11-23', dateRange: '2026-11-17T00:00:00.000/2026-11-24T00:00:00.000' })
  })
})
