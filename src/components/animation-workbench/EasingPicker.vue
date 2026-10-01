<template>
  <select class="easing-select" :value="props.modelValue" @change="onChange">
    <option v-for="option in options" :key="option.value" :value="option.value">
      {{ option.label }}
    </option>
  </select>
</template>

<script setup lang="ts">
const props = defineProps<{
  modelValue: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

// Animation workbench exposes the two most stable easings; underlying EasingType retains legacy compatibility.
const options = [
  { value: 'linear', label: 'Linear' },
  { value: 'step', label: 'Step' },
]

function onChange(event: Event): void {
  emit('update:modelValue', (event.target as HTMLSelectElement).value)
}
</script>

<style scoped>
.easing-select {
  width: 100%;
  min-width: 120px;
  height: 32px;
  padding: 0 10px;
  border: 1px solid #d0d3d9;
  border-radius: 6px;
  background: #fff;
  color: #374151;
  font-size: 12px;
}
</style>
