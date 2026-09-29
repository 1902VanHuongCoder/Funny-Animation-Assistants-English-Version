import { createRouter, createWebHistory } from 'vue-router'

const routes = [
  {
    path: '/',
    redirect: '/project'
  },
  {
    path: '/project',
    name: 'ProjectHome',
    component: () => import('@/views/ProjectHomePage.vue'),
    meta: { title: 'Project Home' }
  },
  {
    path: '/episode/:id/edit',
    name: 'EpisodeEdit',
    component: () => import('@/views/EpisodeEditPage.vue'),
    meta: { title: 'Edit Animation' }
  },
  {
    path: '/assets/:type',
    name: 'AssetManager',
    component: () => import('@/views/AssetManagerPage.vue'),
    meta: { title: 'Asset Manager' }
  },
  {
    path: '/screenplay/:episodeId',
    name: 'ScreenplayEditor',
    component: () => import('@/views/ScreenplayEditorPage.vue'),
    meta: { title: 'Script Editor' }
  },
  {
    path: '/about',
    name: 'About',
    component: () => import('@/views/AboutPage.vue'),
    meta: { title: 'About', requiresAuth: false }
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

export default router
