import type { Node } from '@xyflow/react'
import type { ProxmoxEdge, ProxmoxNode } from '@/components/proxmox/types'
import type { NodeData } from '@/types'
import { layoutProxmoxContainers, measureProxmoxContainers, type XY } from './proxmoxContainerLayout'
import { generateUUID } from './uuid'

const UNGROUPED_PREFIX = 'proxmox-ungrouped-'
const UNGROUPED_LABEL = 'Ungrouped Proxmox guests'

export function resolveProxmoxImport(
  imported: ProxmoxNode[],
  edges: ProxmoxEdge[],
  existing: Node<NodeData>[],
) {
  const byId = new Map(existing.map((node) => [node.id, node]))
  const byDevice = new Map(existing.filter((node) => node.data.device_id).map((node) => [node.data.device_id, node]))
  const ids = new Map<string, string>()
  const nodes = new Map<string, Node<NodeData>>()
  const hostByAddress = new Map(
    existing.filter((node) => node.data.type === 'proxmox').map((node) => [node.id, node.id]),
  )

  for (const device of imported) {
    const previous = byId.get(device.id) ?? (device.device_id ? byDevice.get(device.device_id) : undefined)
    const id = previous?.id ?? device.id
    const status = device.status === 'online' || device.status === 'offline' ? device.status : 'unknown'
    ids.set(device.id, id)
    nodes.set(id, {
      ...previous,
      id,
      type: device.type,
      position: previous?.position ?? { x: 0, y: 0 },
      data: {
        label: device.label,
        services: [],
        ...previous?.data,
        type: device.type,
        status,
        ...(device.device_id ? { device_id: device.device_id } : {}),
        ...(device.ip ? { ip: device.ip } : {}),
        ...(device.hostname ? { hostname: device.hostname } : {}),
      },
    })
    if (device.type === 'proxmox') {
      hostByAddress.set(device.id, id)
      hostByAddress.set(device.ieee_address, id)
    }
  }

  const sourceByGuest = new Map(edges.map(({ source, target }) => [target, source]))
  const parentByGuest = new Map<string, string>()
  for (const device of imported) {
    if (device.type === 'proxmox') continue
    const host = hostByAddress.get(device.parent_ieee ?? '')
      ?? hostByAddress.get(sourceByGuest.get(device.id) ?? '')
    const guest = ids.get(device.id)!
    if (host && host !== guest) parentByGuest.set(guest, host)
  }

  return { nodes, ids, parentByGuest }
}

export function layoutProxmoxImport(
  { nodes, parentByGuest }: ReturnType<typeof resolveProxmoxImport>,
  existing: Node<NodeData>[],
  center: (width: number, height: number) => XY,
) {
  const byId = new Map(existing.map((node) => [node.id, node]))
  const children: Record<string, string[]> = {}
  for (const node of nodes.values()) {
    if (node.data.type === 'proxmox') children[node.id] = []
  }
  const ungrouped = [...nodes.values()].filter((node) => node.data.type !== 'proxmox' && !parentByGuest.has(node.id))
  const existingSection = existing.find((node) => node.data.type === 'group' && node.id.startsWith(UNGROUPED_PREFIX))
  const sectionId = existingSection?.id ?? (ungrouped.length ? UNGROUPED_PREFIX + generateUUID() : undefined)

  for (const [guest, host] of parentByGuest) (children[host] ??= []).push(guest)
  if (sectionId) children[sectionId] = ungrouped.map((node) => node.id)

  for (const node of existing) {
    if (!nodes.has(node.id) && node.parentId && children[node.parentId]) {
      children[node.parentId].push(node.id)
    }
  }

  const hosts = Object.keys(children).filter((id) => id !== sectionId)
  const hostSize = measureProxmoxContainers(hosts, children, 0)
  const sectionSize = sectionId ? measureProxmoxContainers([sectionId], children, 0) : { width: 0, height: 0 }
  const origin = center(Math.max(hostSize.width, sectionSize.width), hostSize.height + sectionSize.height)
  const hostLayout = layoutProxmoxContainers(hosts, children, [], origin)
  const bottom = Math.max(origin.y + hostSize.height, ...hosts.map((id) => {
    const host = byId.get(id)
    return (host?.position.y ?? origin.y) + Math.max(host?.height ?? 0, hostLayout.hostSizes[id].height)
  }))
  const sectionLayout = sectionId
    ? layoutProxmoxContainers([sectionId], children, [], { x: origin.x, y: bottom + (hosts.length ? 60 : 0) })
    : undefined

  const result: Node<NodeData>[] = []
  for (const id of Object.keys(children)) {
    const isSection = id === sectionId
    const previous = byId.get(id)
    const host = nodes.get(id) ?? previous ?? {
      id,
      type: 'group',
      data: { type: 'group', label: UNGROUPED_LABEL, status: 'unknown', services: [] },
    } satisfies Partial<Node<NodeData>>
    const layout = isSection ? sectionLayout! : hostLayout
    const position = previous && !previous.parentId ? previous.position : layout.positions[id]
    const size = layout.hostSizes[id]
    const emptySection = isSection && children[id].length === 0
    if (emptySection) continue
    result.push({
      ...host,
      position,
      width: Math.max(previous?.width ?? 0, size.width),
      height: Math.max(previous?.height ?? 0, size.height),
      data: {
        ...host.data,
        parent_id: undefined,
        ...(isSection ? {} : { container_mode: true }),
      },
    })

    for (const childId of children[id]) {
      const child = nodes.get(childId) ?? byId.get(childId)!
      const slot = layout.positions[childId]
      result.push({
        ...child,
        position: { x: position.x + slot.x - layout.positions[id].x, y: position.y + slot.y - layout.positions[id].y },
        data: { ...child.data, parent_id: id },
      })
    }
  }

  return { nodes: result, emptySectionId: sectionId && children[sectionId].length === 0 ? sectionId : undefined }
}
