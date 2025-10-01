<template>
  <div
    :style="{
      backgroundColor: 'white',
      borderRadius: '8px',
      padding: '1.5rem',
      maxWidth: '400px',
      width: '90%',
      boxShadow: '0 10px 25px rgba(0, 0, 0, 0.1)',
      border: '1px solid #e5e7eb',
    }"
    @click.stop
  >
    <slot />
  </div>
</template>
