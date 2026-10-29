<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { createIconifyIcon } from '@vben/icons';
import { preferences } from '@vben/preferences';
import { serverMode, session } from '../session';
import { workspaceActivePath, workspaceSections } from '../navigation';
const emit = defineEmits<{ select: [] }>();
const route = useRoute();
const active = computed(() => workspaceActivePath(route.path, route.query.tab));
const collapsed = computed(() => preferences.sidebar.collapsed && !preferences.app.isMobile);
const sections = computed(() => workspaceSections.map(section => ({ ...section, links: section.links.filter(link => !link.admin || !serverMode || session.user?.role === 'admin').map(link => ({ ...link, component: createIconifyIcon(link.icon!) })) })));
function navigate() { emit('select'); }
</script>
<template>
  <nav class="workspace-nav" :class="{ 'is-collapsed': collapsed }" aria-label="业务导航">
    <section v-for="(section, index) in sections" :key="index">
      <p v-if="section.title && !collapsed" class="workspace-nav-label">{{ section.title }}</p>
      <RouterLink v-for="link in section.links" :key="link.path" :to="link.path" :title="link.title" :aria-current="active === link.path ? 'page' : undefined" :class="{ 'is-active': active === link.path }" @click="navigate">
        <component :is="link.component" /><span v-if="!collapsed">{{ link.title }}</span>
      </RouterLink>
    </section>
  </nav>
</template>
