<template>
  <div class="empty-state">
    <div class="empty-icon">
      🎬️
    </div>
    <h3 class="empty-title">
      No Episodes Created Yet
    </h3>
    <p class="empty-description">
      Click "Create First Episode" to start creating your animation!
    </p>
  </div>
</template>

<style scoped>
.empty-state {
  text-align: center;
  padding: 80px 24px;
}

.empty-icon {
  font-size: 80px;
  margin-bottom: 24px;
  opacity: 0.5;
}

.empty-title {
  margin: 0 0 12px 0;
  font-size: 20px;
  font-weight: 600;
  color: #1f2937;
}

.empty-description {
  margin: 0;
  font-size: 14px;
  color: #6b7280;
}
</style>
