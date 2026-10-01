/** Grouping object tree node (constructed by consumer) */
export interface GroupingTreeNode {
  id: string
  name: string
  icon: string
  depth: number
  parentId: string | undefined
  children: GroupingTreeNode[]
}

/** Flattened node (for rendering) */
export interface FlatGroupingNode {
  id: string
  name: string
  icon: string
  depth: number
  parentId: string | undefined
  hasChildren: boolean
}

/** Flatten tree structure into a render list */
export function flattenGroupingTree(
  roots: GroupingTreeNode[],
  expandedIds: Set<string>,
): FlatGroupingNode[] {
  const result: FlatGroupingNode[] = []
  function walk(nodes: GroupingTreeNode[]): void {
    for (const node of nodes) {
      result.push({
        id: node.id,
        name: node.name,
        icon: node.icon,
        depth: node.depth,
        parentId: node.parentId,
        hasChildren: node.children.length > 0,
      })
      if (node.children.length > 0 && expandedIds.has(node.id)) {
        walk(node.children)
      }
    }
  }
  walk(roots)
  return result
}
