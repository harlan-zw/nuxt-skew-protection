<template>
  <SkewNotification v-slot="{ isOpen, dismiss }">
    <button v-if="isOpen" data-testid="dismiss" @click="dismiss">
      Dismiss
    </button>
  </SkewNotification>
  <NuxtLink to="/about" data-testid="about-link">
    About
  </NuxtLink>
</template>
