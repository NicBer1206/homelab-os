import { describe, expect, it } from 'vitest'
import type { ProxmoxNode } from '@/components/proxmox/types'
import { makeNode } from '@/test/factories'
import { layoutProxmoxImport, resolveProxmoxImport } from '../proxmox-guest-nesting'

const center = () => ({ x: 0, y: 0 })
const host: ProxmoxNode = {
  id: 'pve-node-lab',
  ieee_address: 'pve-node-lab',
  device_id: 'inventory-host',
  label: 'lab',
  status: 'online',
  type: 'proxmox',
}
const guest: ProxmoxNode = {
  id: 'pve-lab-101',
  ieee_address: 'pve-lab-101',
  device_id: 'inventory-guest',
  label: 'guest',
  status: 'offline',
  type: 'vm',
}

describe('Proxmox guest nesting', () => {
  it('reuses inventory-backed canvas nodes and preserves their custom data', () => {
    const existing = [
      makeNode('canvas-host', { type: 'proxmox', device_id: host.device_id, label: 'Lab host' }),
      makeNode('canvas-guest', { type: 'vm', device_id: guest.device_id, label: 'My VM' }),
    ]
    const devices = [host, { ...guest, parent_ieee: host.ieee_address }]
    const resolved = resolveProxmoxImport(devices, [], existing)
    const { nodes } = layoutProxmoxImport(resolved, existing, center)

    expect(nodes.map((node) => node.id)).toEqual(['canvas-host', 'canvas-guest'])
    expect(nodes[0].data).toMatchObject({ label: 'Lab host', container_mode: true })
    expect(nodes[1].data).toMatchObject({ label: 'My VM', parent_id: 'canvas-host', status: 'offline' })
  })

  it('reuses the ungrouped section and marks it for removal when its guest gets a host', () => {
    const section = makeNode('proxmox-ungrouped-test', { type: 'group' })
    const existingGuest = {
      ...makeNode(guest.id, { type: 'vm', parent_id: section.id }),
      parentId: section.id,
    }
    const existing = [section, existingGuest]
    const ungrouped = layoutProxmoxImport(resolveProxmoxImport([guest], [], existing), existing, center)
    expect(ungrouped.nodes.map((node) => node.id)).toEqual([section.id, guest.id])

    const edges = [{ source: host.id, target: guest.id }]
    const nested = layoutProxmoxImport(resolveProxmoxImport([host, guest], edges, existing), existing, center)
    expect(nested.emptySectionId).toBe(section.id)
    expect(nested.nodes.find((node) => node.id === guest.id)?.data.parent_id).toBe(host.id)
  })
})
