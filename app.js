import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/module/supabase.js';

const SUPABASE_URL = 'https://pwiqiinajpyrmhdhgobx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB3aXFpaW5hanB5cm1oZGhnb2J4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI4NDMzODQsImV4cCI6MjA5ODQxOTM4NH0.eDbE4-1KyQ-XiEnRzbJlMcpgb06JikSu67e4FzVOUJM';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const state = {
  user: null,
  profile: null,
  activeView: 'customer',
  restaurants: [],
  menuItems: [],
  cart: {},
  selectedRestaurant: null,
  availableDrivers: [],
  notifications: [],
};

const roleLabels = {
  customer: 'Cliente',
  merchant: 'Comercio',
  rider: 'Motorizado',
};

const statusNames = {
  pending: 'Pendiente',
  accepted: 'Aceptado',
  preparing: 'Preparando',
  ready: 'Listo',
  on_the_way: 'En camino',
  delivered: 'Entregado',
  canceled: 'Cancelado',
};

const elements = {};

function $(selector) {
  return document.querySelector(selector);
}

function show(selector) {
  $(selector)?.classList.remove('hidden');
}

function hide(selector) {
  $(selector)?.classList.add('hidden');
}

function notify(message, type = 'success') {
  const bar = $('#toast');
  if (!bar) return;
  bar.textContent = message;
  bar.className = `toast ${type}`;
  bar.style.opacity = '1';
  setTimeout(() => {
    bar.style.opacity = '0';
  }, 3600);
}

async function init() {
  cacheElements();
  bindEvents();
  await seedSampleData();
  const { data } = await supabase.auth.getSession();
  const session = data?.session;
  if (session?.user) {
    state.user = session.user;
    await refreshProfile();
    enterApp();
  } else {
    showAuthScreen();
  }
}

function cacheElements() {
  elements.authScreen = $('#auth-screen');
  elements.mainScreen = $('#main-screen');
  elements.logoutBtn = $('#logoutBtn');
  elements.currentRole = $('#currentRole');
  elements.statusBar = $('#statusBar');
  elements.appContent = $('#appContent');
  elements.authSwitch = $('#authSwitch');
  elements.authTitle = $('#authTitle');
  elements.loginForm = $('#loginForm');
  elements.registerForm = $('#registerForm');
  elements.viewButtons = document.querySelectorAll('.nav-btn');
  elements.notificationsBadge = $('#notificationBadge');
}

function bindEvents() {
  $('#toggleToRegister')?.addEventListener('click', () => toggleAuthMode('register'));
  $('#toggleToLogin')?.addEventListener('click', () => toggleAuthMode('login'));
  elements.loginForm?.addEventListener('submit', handleLogin);
  elements.registerForm?.addEventListener('submit', handleRegister);
  elements.logoutBtn?.addEventListener('click', handleLogout);
  elements.viewButtons?.forEach((button) => {
    button.addEventListener('click', () => changeView(button.dataset.view));
  });
}

function toggleAuthMode(mode) {
  const loginPanel = $('#loginPanel');
  const registerPanel = $('#registerPanel');
  if (mode === 'register') {
    loginPanel.classList.add('hidden');
    registerPanel.classList.remove('hidden');
    $('#authTitle').textContent = 'Registro';
  } else {
    loginPanel.classList.remove('hidden');
    registerPanel.classList.add('hidden');
    $('#authTitle').textContent = 'Iniciar sesión';
  }
}

async function handleLogin(event) {
  event.preventDefault();
  const email = $('#loginEmail').value.trim();
  const password = $('#loginPassword').value.trim();
  if (!email || !password) {
    notify('Completa correo y contraseña.', 'error');
    return;
  }
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    notify(error.message, 'error');
    return;
  }
  state.user = data.user;
  await refreshProfile();
  enterApp();
}

async function handleRegister(event) {
  event.preventDefault();
  const email = $('#registerEmail').value.trim();
  const password = $('#registerPassword').value.trim();
  const fullName = $('#registerName').value.trim();
  const phone = $('#registerPhone').value.trim();
  const role = $('#registerRole').value;
  const businessName = $('#registerBusinessName').value.trim();
  if (!email || !password || !fullName || !phone) {
    notify('Completa todos los campos obligatorios.', 'error');
    return;
  }
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) {
    notify(error.message, 'error');
    return;
  }
  state.user = data.user;
  await upsertProfile({ full_name: fullName, phone, role, business_name: businessName });
  await refreshProfile();
  notify('Registro exitoso. Ya puedes iniciar sesión.', 'success');
  enterApp();
}

async function upsertProfile(profile) {
  if (!state.user) return;
  const row = {
    id: state.user.id,
    full_name: profile.full_name,
    phone: profile.phone,
    role: profile.role,
    business_name: profile.business_name || null,
  };
  const { error } = await supabase.from('profiles').upsert(row, { onConflict: 'id' });
  if (error) {
    console.error('Error creando perfil', error);
  }
}

async function refreshProfile() {
  if (!state.user) return;
  const { data, error } = await supabase.from('profiles').select('*').eq('id', state.user.id).single();
  if (error) {
    console.error('No se pudo cargar el perfil', error);
    return;
  }
  state.profile = data;
  if (!state.profile.business_name && state.profile.role === 'merchant') {
    await ensureMerchantStore();
  }
  await startRealtimeListeners();
}

async function enterApp() {
  hide('#auth-screen');
  show('#main-screen');
  elements.logoutBtn.classList.remove('hidden');
  if (state.profile?.role) {
    state.activeView = state.profile.role;
  }
  await loadNotifications();
  renderApp();
}

function showAuthScreen() {
  show('#auth-screen');
  hide('#main-screen');
  elements.logoutBtn.classList.add('hidden');
  toggleAuthMode('login');
}

async function handleLogout() {
  await supabase.auth.signOut();
  state.user = null;
  state.profile = null;
  state.cart = {};
  showAuthScreen();
  notify('Sesión cerrada.', 'success');
}

function changeView(view) {
  state.activeView = view;
  renderNavButtons();
  renderApp();
}

function renderNavButtons() {
  elements.viewButtons.forEach((button) => {
    button.classList.toggle('active', button.dataset.view === state.activeView);
  });
}

async function renderApp() {
  renderNavButtons();
  elements.currentRole.textContent = state.profile
    ? `${state.profile.full_name || 'Usuario'} · ${roleLabels[state.profile.role] || 'Cliente'}`
    : 'Delivery Pro';
  elements.statusBar.textContent = `Vista: ${roleLabels[state.activeView]} · Conectado como ${state.profile?.full_name || 'Usuario'}`;
  if (state.activeView === 'customer') {
    await renderCustomerView();
  } else if (state.activeView === 'merchant') {
    await renderMerchantView();
  } else if (state.activeView === 'rider') {
    await renderRiderView();
  }
}

async function renderCustomerView() {
  await loadRestaurants();
  await loadCustomerOrders();
  const restaurantCards = state.restaurants
    .map((restaurant) => {
      return `<article class="card restaurant-card">
        <div class="restaurant-card__info">
          <h3>${restaurant.name}</h3>
          <p>${restaurant.category} · ${restaurant.address}</p>
        </div>
        <button class="secondary" data-id="${restaurant.id}" data-action="view-menu">Ver menú</button>
      </article>`;
    })
    .join('');

  const selectedMenu = state.selectedRestaurant
    ? await buildRestaurantMenu(state.selectedRestaurant)
    : '<p class="empty-state">Selecciona un comercio para ver su menú.</p>';

  const cartHtml = buildCartHtml();

  elements.appContent.innerHTML = `
    <section class="panel">
      <header class="panel__header">
        <h2>Restaurantes disponibles</h2>
      </header>
      <div class="cards-grid">${restaurantCards}</div>
    </section>
    <section class="panel">
      <header class="panel__header">
        <h2>${state.selectedRestaurant ? state.selectedRestaurant.name : 'Menú'}</h2>
      </header>
      ${selectedMenu}
    </section>
    <section class="panel order-panel">
      <header class="panel__header">
        <h2>Carrito</h2>
      </header>
      ${cartHtml}
    </section>
  `;

  document.querySelectorAll('[data-action="view-menu"]').forEach((button) => {
    button.addEventListener('click', async () => {
      const restaurantId = button.dataset.id;
      state.selectedRestaurant = state.restaurants.find((rest) => rest.id === restaurantId);
      await renderCustomerView();
    });
  });
  document.querySelectorAll('[data-action="add-to-cart"]').forEach((button) => {
    button.addEventListener('click', () => adjustCart(button.dataset.id, 1));
  });
  document.querySelectorAll('[data-action="remove-from-cart"]').forEach((button) => {
    button.addEventListener('click', () => adjustCart(button.dataset.id, -1));
  });
  document.querySelectorAll('[data-action="place-order"]').forEach((button) => {
    button.addEventListener('click', placeOrder);
  });
}

async function renderMerchantView() {
  const restaurant = await ensureMerchantStore();
  await loadMerchantOrders(restaurant.id);
  await loadMenuItems(restaurant.id);
  await loadAvailableDrivers();
  const orderRows = state.orders
    .map((order) => {
      const driverName = order.driver_full_name || 'Sin asignar';
      const canUpdate = ['pending', 'accepted', 'preparing', 'ready', 'on_the_way'].includes(order.status);
      return `<article class="card order-card">
        <div>
          <h3>${order.status ? statusNames[order.status] : 'Pedido'}</h3>
          <p><strong>Cliente:</strong> ${order.customer_name}</p>
          <p><strong>Total:</strong> $${order.total?.toFixed(2) || '0.00'}</p>
          <p><strong>Dirección:</strong> ${order.delivery_address}</p>
          <p><strong>Repartidor:</strong> ${driverName}</p>
        </div>
        <div class="order-actions">
          <select data-order="${order.id}" class="driver-select">
            <option value="">Asignar motorizado</option>
            ${state.availableDrivers
              .map((driver) => `<option value="${driver.id}" ${order.driver_id === driver.id ? 'selected' : ''}>${driver.full_name}</option>`)
              .join('')}
          </select>
          <button class="secondary" data-action="change-status" data-id="${order.id}" data-status="accepted">Aceptar</button>
          <button class="secondary" data-action="change-status" data-id="${order.id}" data-status="preparing">Preparando</button>
          <button class="secondary" data-action="change-status" data-id="${order.id}" data-status="ready">Listo</button>
          <button class="danger" data-action="change-status" data-id="${order.id}" data-status="canceled">Cancelar</button>
        </div>
      </article>`;
    })
    .join('');

  const menuItemsHtml = state.menuItems
    .map((item) => {
      return `<article class="card small-card">
        <div>
          <h4>${item.name}</h4>
          <p>${item.description}</p>
          <p><strong>$${item.price?.toFixed(2) || '0.00'}</strong></p>
        </div>
      </article>`;
    })
    .join('');

  elements.appContent.innerHTML = `
    <section class="panel">
      <header class="panel__header">
        <h2>Mi comercio</h2>
      </header>
      <div class="store-card">
        <h3>${restaurant.name}</h3>
        <p>${restaurant.category} · ${restaurant.address}</p>
        <p>${restaurant.description}</p>
      </div>
    </section>
    <section class="panel">
      <header class="panel__header">
        <h2>Pedidos activos</h2>
      </header>
      ${orderRows.length ? orderRows : '<p class="empty-state">No hay pedidos nuevos.</p>'}
    </section>
    <section class="panel">
      <header class="panel__header">
        <h2>Menú</h2>
      </header>
      ${menuItemsHtml || '<p class="empty-state">Agrega tus productos en Supabase.</p>'}
    </section>
  `;

  document.querySelectorAll('.driver-select').forEach((select) => {
    select.addEventListener('change', async () => {
      const orderId = select.dataset.order;
      const driverId = select.value;
      await assignDriver(orderId, driverId);
    });
  });
  document.querySelectorAll('[data-action="change-status"]').forEach((button) => {
    button.addEventListener('click', async () => {
      await updateOrderStatus(button.dataset.id, button.dataset.status);
    });
  });
}

async function renderRiderView() {
  await loadAssignedOrders();
  await loadAvailableOrders();
  const assignedHtml = state.orders
    .map((order) => {
      return `<article class="card order-card">
        <div>
          <h3>${statusNames[order.status] || 'Pedido'}</h3>
          <p><strong>Cliente:</strong> ${order.customer_name}</p>
          <p><strong>Comercio:</strong> ${order.restaurant_name}</p>
          <p><strong>Dirección:</strong> ${order.delivery_address}</p>
          <p><strong>Total:</strong> $${order.total?.toFixed(2)}</p>
        </div>
        <div class="order-actions">
          ${order.status === 'ready' ? `<button data-action="update-status" data-id="${order.id}" data-status="on_the_way">En camino</button>` : ''}
          ${order.status === 'on_the_way' ? `<button data-action="update-status" data-id="${order.id}" data-status="delivered">Entregado</button>` : ''}
        </div>
      </article>`;
    })
    .join('');

  const availableOrders = state.availableOrders
    .map((order) => {
      return `<article class="card order-card">
        <div>
          <h3>${statusNames[order.status] || 'Pedido disponible'}</h3>
          <p><strong>Comercio:</strong> ${order.restaurant_name}</p>
          <p><strong>Total:</strong> $${order.total?.toFixed(2)}</p>
          <p><strong>Dirección:</strong> ${order.delivery_address}</p>
        </div>
        <div class="order-actions">
          <button class="primary" data-action="claim-order" data-id="${order.id}">Tomar pedido</button>
        </div>
      </article>`;
    })
    .join('');

  elements.appContent.innerHTML = `
    <section class="panel">
      <header class="panel__header">
        <h2>Mis pedidos asignados</h2>
      </header>
      ${assignedHtml || '<p class="empty-state">No tienes pedidos asignados.</p>'}
    </section>
    <section class="panel">
      <header class="panel__header">
        <h2>Pedidos disponibles</h2>
      </header>
      ${availableOrders || '<p class="empty-state">No hay pedidos disponibles para tomar.</p>'}
    </section>
  `;

  document.querySelectorAll('[data-action="claim-order"]').forEach((button) => {
    button.addEventListener('click', async () => {
      await claimOrder(button.dataset.id);
    });
  });
  document.querySelectorAll('[data-action="update-status"]').forEach((button) => {
    button.addEventListener('click', async () => {
      await updateOrderStatus(button.dataset.id, button.dataset.status);
    });
  });
}

function buildCartHtml() {
  const items = Object.values(state.cart);
  if (!items.length) {
    return '<p class="empty-state">El carrito está vacío.</p>';
  }
  const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const rows = items
    .map((item) => {
      return `<div class="cart-item">
        <div>
          <h4>${item.name}</h4>
          <p>${item.quantity} x $${item.price.toFixed(2)}</p>
        </div>
        <div class="cart-controls">
          <button data-action="remove-from-cart" data-id="${item.id}">-</button>
          <span>${item.quantity}</span>
          <button data-action="add-to-cart" data-id="${item.id}">+</button>
        </div>
      </div>`;
    })
    .join('');

  return `
    <div>${rows}</div>
    <div class="cart-summary">
      <strong>Total: $${total.toFixed(2)}</strong>
      <textarea id="deliveryAddress" placeholder="Dirección de entrega" rows="2"></textarea>
      <button class="primary" data-action="place-order">Enviar pedido</button>
    </div>
  `;
}

function adjustCart(itemId, delta) {
  const item = state.menuItems.find((menu) => menu.id === itemId);
  if (!item) return;
  state.cart[itemId] = state.cart[itemId] || { ...item, quantity: 0 };
  state.cart[itemId].quantity = Math.max(0, state.cart[itemId].quantity + delta);
  if (state.cart[itemId].quantity === 0) {
    delete state.cart[itemId];
  }
  renderApp();
}

async function placeOrder() {
  const address = $('#deliveryAddress')?.value.trim();
  if (!address) {
    notify('Ingresa una dirección de entrega.', 'error');
    return;
  }
  const items = Object.values(state.cart);
  if (!items.length || !state.selectedRestaurant) {
    notify('Selecciona al menos un producto.', 'error');
    return;
  }
  const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const orderPayload = {
    customer_id: state.profile.id,
    restaurant_id: state.selectedRestaurant.id,
    status: 'pending',
    total,
    delivery_address: address,
  };
  const { data: orderData, error: orderError } = await supabase.from('orders').insert(orderPayload).select().single();
  if (orderError) {
    notify(orderError.message, 'error');
    return;
  }
  const orderItems = items.map((item) => ({
    order_id: orderData.id,
    menu_item_id: item.id,
    quantity: item.quantity,
    unit_price: item.price,
  }));
  const { error: itemsError } = await supabase.from('order_items').insert(orderItems);
  if (itemsError) {
    notify(itemsError.message, 'error');
    return;
  }
  await createNotification(orderData.restaurant_id, `Nuevo pedido recibido de ${state.profile.full_name}.`);
  state.cart = {};
  state.selectedRestaurant = null;
  notify('Pedido enviado. El comercio lo recibe en tiempo real.', 'success');
  renderApp();
}

async function createNotification(userId, message) {
  await supabase.from('notifications').insert({ user_id: userId, message });
}

async function assignDriver(orderId, driverId) {
  const payload = driverId ? { driver_id: driverId, status: 'accepted' } : { driver_id: null };
  const { error } = await supabase.from('orders').update(payload).eq('id', orderId);
  if (error) {
    notify(error.message, 'error');
    return;
  }
  if (driverId) {
    await createNotification(driverId, 'Se te asignó un nuevo pedido. Revisa tu panel.');
  }
  notify('Repartidor asignado.', 'success');
  renderApp();
}

async function updateOrderStatus(orderId, status) {
  const { error, data } = await supabase.from('orders').update({ status }).eq('id', orderId).select().single();
  if (error) {
    notify(error.message, 'error');
    return;
  }
  const destination = [data.customer_id, data.driver_id, data.restaurant_id].filter(Boolean);
  for (const userId of destination) {
    await createNotification(userId, `Pedido ${data.id} actualizado a ${statusNames[status]}.`);
  }
  notify(`Estado actualizado a ${statusNames[status]}.`, 'success');
  renderApp();
}

async function claimOrder(orderId) {
  const { error, data } = await supabase.from('orders').update({ driver_id: state.profile.id, status: 'accepted' }).eq('id', orderId).select().single();
  if (error) {
    notify(error.message, 'error');
    return;
  }
  await createNotification(data.restaurant_id, `El motorizado ${state.profile.full_name} tomó tu pedido.`);
  notify('Has tomado el pedido.', 'success');
  renderApp();
}

async function loadRestaurants() {
  const { data, error } = await supabase.from('restaurants').select('*').eq('active', true).order('name');
  if (error) {
    console.error(error);
    return;
  }
  state.restaurants = data || [];
}

async function buildRestaurantMenu(restaurant) {
  if (!restaurant) return '<p class="empty-state">Selecciona un comercio.</p>';
  const { data, error } = await supabase
    .from('menu_items')
    .select('*')
    .eq('restaurant_id', restaurant.id)
    .eq('active', true)
    .order('name');
  if (error) {
    console.error(error);
    return '<p class="empty-state">Error al cargar menú.</p>';
  }
  state.menuItems = data || [];
  if (!state.menuItems.length) {
    return '<p class="empty-state">El comercio no tiene productos activos.</p>';
  }
  return `<div class="cards-grid">${state.menuItems
    .map(
      (item) => `<article class="card menu-card">
        <div>
          <h4>${item.name}</h4>
          <p>${item.description}</p>
          <p><strong>$${item.price?.toFixed(2) || '0.00'}</strong></p>
        </div>
        <button class="primary" data-action="add-to-cart" data-id="${item.id}">Agregar</button>
      </article>`
    )
    .join('')}</div>`;
}

async function loadCustomerOrders() {
  // Keep customer orders updated for possible later expansion
  const { data, error } = await supabase
    .from('orders')
    .select('*, restaurant:restaurants(name), driver:profiles(full_name), customer:profiles(full_name)')
    .eq('customer_id', state.profile.id)
    .order('created_at', { ascending: false });
  if (error) {
    console.error(error);
  }
  state.customerOrders = data || [];
}

async function loadMerchantOrders(restaurantId) {
  const { data, error } = await supabase
    .from('orders')
    .select('*, customer:profiles(full_name), driver:profiles(full_name)')
    .eq('restaurant_id', restaurantId)
    .order('created_at', { ascending: false });
  if (error) {
    console.error(error);
    state.orders = [];
    return;
  }
  state.orders = (data || []).map((order) => ({
    ...order,
    customer_name: order.customer?.full_name || 'Cliente',
    driver_full_name: order.driver?.full_name || null,
  }));
}

async function loadMenuItems(restaurantId) {
  const { data, error } = await supabase.from('menu_items').select('*').eq('restaurant_id', restaurantId).order('name');
  if (error) {
    console.error(error);
    state.menuItems = [];
    return;
  }
  state.menuItems = data || [];
}

async function loadAvailableDrivers() {
  const { data, error } = await supabase.from('profiles').select('*').eq('role', 'rider').order('full_name');
  if (error) {
    console.error(error);
    state.availableDrivers = [];
    return;
  }
  state.availableDrivers = data || [];
}

async function loadAssignedOrders() {
  const { data, error } = await supabase
    .from('orders')
    .select('*, customer:profiles(full_name), restaurant:restaurants(name)')
    .eq('driver_id', state.profile.id)
    .in('status', ['accepted', 'preparing', 'ready', 'on_the_way'])
    .order('created_at', { ascending: false });
  if (error) {
    console.error(error);
    state.orders = [];
    return;
  }
  state.orders = (data || []).map((order) => ({
    ...order,
    customer_name: order.customer?.full_name || 'Cliente',
    restaurant_name: order.restaurant?.name || 'Comercio',
  }));
}

async function loadAvailableOrders() {
  const { data, error } = await supabase
    .from('orders')
    .select('*, restaurant:restaurants(name)')
    .eq('status', 'ready')
    .is('driver_id', null)
    .order('created_at', { ascending: true });
  if (error) {
    console.error(error);
    state.availableOrders = [];
    return;
  }
  state.availableOrders = (data || []).map((order) => ({
    ...order,
    restaurant_name: order.restaurant?.name || 'Comercio',
  }));
}

async function startRealtimeListeners() {
  if (!state.profile) return;
  const channel = supabase.channel(`private-user-${state.profile.id}`);
  channel.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${state.profile.id}` }, (payload) => {
    notify(payload.new.message, 'success');
    loadNotifications();
  });
  if (state.profile.role === 'merchant') {
    channel.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders', filter: `restaurant_id=eq.${state.profile.id}` }, (payload) => {
      notify('Tienes un nuevo pedido.', 'success');
      renderApp();
    });
  }
  if (state.profile.role === 'rider') {
    channel.on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders', filter: `driver_id=eq.${state.profile.id}` }, (payload) => {
      notify('Tu pedido ha sido actualizado.', 'success');
      renderApp();
    });
  }
  if (state.profile.role === 'customer') {
    channel.on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders', filter: `customer_id=eq.${state.profile.id}` }, (payload) => {
      notify('Actualización de tu pedido.', 'success');
      renderApp();
    });
  }
  await channel.subscribe();
}

async function loadNotifications() {
  if (!state.profile) return;
  const { data, error } = await supabase.from('notifications').select('*').eq('user_id', state.profile.id).order('created_at', { ascending: false }).limit(5);
  if (error) {
    console.error(error);
    return;
  }
  state.notifications = data || [];
  const count = state.notifications.length;
  $('#notificationBadge').textContent = count ? String(count) : '';
}

async function ensureMerchantStore() {
  if (!state.profile || state.profile.role !== 'merchant') return null;
  const { data, error } = await supabase.from('restaurants').select('*').eq('owner_id', state.profile.id).limit(1).single();
  if (error && error.code !== 'PGRST116') {
    console.error('Error buscando comercio', error);
  }
  if (data) {
    return data;
  }
  const defaultStore = {
    owner_id: state.profile.id,
    name: state.profile.business_name || `${state.profile.full_name}'s Comercio`,
    category: 'Delivery',
    address: 'Ubicación de ejemplo',
    description: 'Gestión de pedidos rápida y en tiempo real.',
    active: true,
  };
  const result = await supabase.from('restaurants').insert(defaultStore).select().single();
  if (result.error) {
    console.error('Error creando comercio por defecto', result.error);
    return null;
  }
  return result.data;
}

async function seedSampleData() {
  const { data: restaurants } = await supabase.from('restaurants').select('id').limit(1);
  if (restaurants?.length) return;
  const sampleRestaurants = [
    {
      name: 'Empanadas Central',
      category: 'Empanadas y snacks',
      address: 'Av. Principal 123',
      description: 'Empanadas rellenas y sándwiches rápidos.',
      active: true,
    },
    {
      name: 'La Pizzería Express',
      category: 'Pizzas',
      address: 'Calle Falsa 456',
      description: 'Pizzas artesanales con entrega en 25 min.',
      active: true,
    },
  ];
  const { data: created, error } = await supabase.from('restaurants').insert(sampleRestaurants).select();
  if (error) {
    console.warn('No se pudo sembrar datos de restaurantes de muestra.', error.message);
    return;
  }
  const menuItems = [
    { restaurant_id: created[0].id, name: 'Empanada de carne', description: 'Clásica de carne con un toque de especias.', price: 120.0, active: true },
    { restaurant_id: created[0].id, name: 'Empanada de jamón y queso', description: 'Rellena y crocante.', price: 130.0, active: true },
    { restaurant_id: created[1].id, name: 'Pizza personal de muzzarella', description: 'Salsa casera y queso mozzarella.', price: 250.0, active: true },
    { restaurant_id: created[1].id, name: 'Pizza fugazzeta', description: 'Cebolla tierna y mucho queso.', price: 280.0, active: true },
  ];
  await supabase.from('menu_items').insert(menuItems);
}

init();
