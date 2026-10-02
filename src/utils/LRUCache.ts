/**
 * LRU (Least Recently Used) Cache
 * Used to control texture memory footprint
 */

export interface CacheNode<K, V> {
  key: K
  value: V
  prev: CacheNode<K, V> | null
  next: CacheNode<K, V> | null
}

export class LRUCache<K, V> {
  private capacity: number
  private cache: Map<K, CacheNode<K, V>>
  private head: CacheNode<K, V> | null = null
  private tail: CacheNode<K, V> | null = null
  private currentSize = 0
  private onEvict: ((key: K, value: V) => void) | undefined

  constructor(capacity: number, onEvict?: (key: K, value: V) => void) {
    this.capacity = capacity
    this.cache = new Map()
    this.onEvict = onEvict
  }

  /**
   * Get cached value and move node to head (most recently used)
   */
  get(key: K): V | undefined {
    const node = this.cache.get(key)
    if (!node) return undefined

    // Move node to head
    this.moveToHead(node)
    return node.value
  }

  /**
   * Set cached value
   */
  set(key: K, value: V): void {
    const existingNode = this.cache.get(key)

    if (existingNode) {
      // Update existing node
      existingNode.value = value
      this.moveToHead(existingNode)
    } else {
      // Create new node
      const newNode: CacheNode<K, V> = {
        key,
        value,
        prev: null,
        next: null
      }

      this.cache.set(key, newNode)
      this.addToHead(newNode)
      this.currentSize++

      // Capacity exceeded, evict least recently used node
      if (this.currentSize > this.capacity) {
        const removed = this.removeTail()
        if (removed) {
          this.cache.delete(removed.key)
          this.currentSize--
          
          // Trigger eviction callback
          if (this.onEvict) {
            this.onEvict(removed.key, removed.value)
          }
        }
      }
    }
  }

  /**
   * Delete specified key
   */
  delete(key: K): boolean {
    const node = this.cache.get(key)
    if (!node) return false

    this.removeNode(node)
    this.cache.delete(key)
    this.currentSize--

    // Trigger eviction callback
    if (this.onEvict) {
      this.onEvict(node.key, node.value)
    }

    return true
  }

  /**
   * Check whether key exists
   */
  has(key: K): boolean {
    return this.cache.has(key)
  }

  /**
   * Clear cache
   */
  clear(): void {
    // Trigger eviction callback for all nodes
    if (this.onEvict) {
      this.cache.forEach((node) => {
        this.onEvict!(node.key, node.value)
      })
    }

    this.cache.clear()
    this.head = null
    this.tail = null
    this.currentSize = 0
  }

  /**
   * Get current cache size
   */
  get size(): number {
    return this.currentSize
  }

  /**
   * Get all keys
   */
  keys(): K[] {
    return Array.from(this.cache.keys())
  }

  /**
   * Add node to head
   */
  private addToHead(node: CacheNode<K, V>): void {
    node.prev = null
    node.next = this.head

    if (this.head) {
      this.head.prev = node
    }

    this.head = node

    this.tail ??= node
  }

  /**
   * Remove specified node
   */
  private removeNode(node: CacheNode<K, V>): void {
    if (node.prev) {
      node.prev.next = node.next
    } else {
      this.head = node.next
    }

    if (node.next) {
      node.next.prev = node.prev
    } else {
      this.tail = node.prev
    }
  }

  /**
   * Move node to head
   */
  private moveToHead(node: CacheNode<K, V>): void {
    this.removeNode(node)
    this.addToHead(node)
  }

  /**
   * Remove tail node
   */
  private removeTail(): CacheNode<K, V> | null {
    if (!this.tail) return null

    const node = this.tail
    this.removeNode(node)
    return node
  }
}
