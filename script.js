let lastDetectedPlatform = null;

// Elementos do DOM
const urlInput = document.getElementById('urlInput');
const extractBtn = document.getElementById('extractBtn');
const resultSection = document.getElementById('resultSection');
const resultContent = document.getElementById('resultContent');
const copyBtn = document.getElementById('copyBtn');
const shareBtn = document.getElementById('shareBtn');
const clearBtn = document.getElementById('clearBtn');
const errorSection = document.getElementById('errorSection');
const errorMessage = document.getElementById('errorMessage');
const loadingSection = document.getElementById('loadingSection');

// Event listeners
extractBtn.addEventListener('click', extractCaption);
urlInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') extractCaption();
});
copyBtn.addEventListener('click', copyToClipboard);
shareBtn.addEventListener('click', shareCaption);
clearBtn.addEventListener('click', clearResults);

/**
 * Função utilitária para retentativas automáticas
 */
async function executeWithRetry(fn, maxRetries = 2, delayMs = 1500) {
    let attempt = 0;
    while (attempt < maxRetries) {
        try {
            return await fn();
        } catch (error) {
            attempt++;
            console.warn(`Tentativa ${attempt} falhou. Motivo: ${error.message}`);
            if (attempt >= maxRetries) throw error;
            // Aguarda um tempo antes de tentar novamente
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
    }
}

/**
 * Extrai a legenda usando a API com retentativa
 */
async function extractCaption() {
    const url = urlInput.value.trim();

    if (!url) {
        showError('Por favor, insira um link do Instagram ou Facebook');
        return;
    }

    if (!isValidSocialUrl(url)) {
        showError('Link inválido. Cole um link válido do Instagram ou Facebook.');
        return;
    }

    showLoading(true);
    hideError();
    hideResults();

    try {
        const caption = await executeWithRetry(() => fetchCaption(url), 2, 1500);
        showResults(caption);
    } catch (error) {
        console.error('Erro final:', error);
        showError(`Não foi possível extrair a legenda após várias tentativas. Verifique se o conteúdo é público.`);
    } finally {
        showLoading(false);
    }
}

/**
 * Valida se a URL é um link válido
 */
function isValidSocialUrl(url) {
    try {
        const urlObj = new URL(url);
        const hostname = urlObj.hostname.toLowerCase();
        const pathname = urlObj.pathname.toLowerCase();

        const isInstagram = hostname.includes('instagram.com');
        if (isInstagram) {
            return /\/(p|reel|reels|tv|stories)\//.test(pathname);
        }

        const isFacebook =
            hostname.includes('facebook.com') ||
            hostname.includes('fb.watch') ||
            hostname.includes('m.facebook.com') ||
            hostname.includes('mbasic.facebook.com');

        if (isFacebook) {
            return /\/(posts|reel|reels|watch|videos|story\.php|permalink\.php)\//.test(pathname) ||
                pathname.includes('/story.php') ||
                pathname.includes('/permalink.php') ||
                urlObj.searchParams.has('story_fbid');
        }

        return false;
    } catch {
        return false;
    }
}

/**
 * Detecta a plataforma da URL
 */
function detectPlatform(url) {
    try {
        const hostname = new URL(url).hostname.toLowerCase();
        if (hostname.includes('instagram.com')) return 'instagram';
        if (
            hostname.includes('facebook.com') ||
            hostname.includes('fb.watch') ||
            hostname.includes('m.facebook.com') ||
            hostname.includes('mbasic.facebook.com')
        ) return 'facebook';
        return null;
    } catch {
        return null;
    }
}

/**
 * Extrai o ID do post/reel/IGTV
 */
function extractPostId(url) {
    const match = url.match(/\/(p|reel|reels|tv|stories)\/([a-zA-Z0-9_-]+)/);
    return match ? match[2] : null;
}

/**
 * Busca legenda conforme plataforma
 */
async function fetchCaption(url) {
    const platform = detectPlatform(url);
    lastDetectedPlatform = platform;

    if (!platform) throw new Error('Plataforma não suportada. Use Instagram ou Facebook.');
    if (platform === 'instagram') return fetchInstagramCaption(url);
    if (platform === 'facebook') return fetchFacebookCaption(url);

    throw new Error('Não foi possível identificar a plataforma do link.');
}

/**
 * Busca legenda do Instagram
 */
async function fetchInstagramCaption(url) {
    const postId = extractPostId(url);
    if (!postId) throw new Error('Não foi possível extrair o ID do conteúdo do Instagram.');

    const cleanUrl   = `https://www.instagram.com/p/${postId}/`;
    const embedUrl   = `https://www.instagram.com/p/${postId}/embed/captioned/`;

    try {
        const data = await fetchJson(`https://noembed.com/embed?url=${encodeURIComponent(cleanUrl)}`);
        if (data?.title) {
            const caption = sanitizeCaption(data.title, 'instagram');
            if (caption && caption.length > 2) return caption;
        }
        if (data?.html) {
            const caption = extractInstagramCaptionFromHTML(data.html);
            if (caption) return caption;
        }
    } catch (e) { console.warn('noembed falhou:', e); }

    try {
        const text = await fetchWithProxy(embedUrl, 'jina');
        const caption = extractInstagramCaptionFromHTML(text);
        if (caption) return caption;
    } catch (e) { console.warn('Jina embed falhou:', e); }

    try {
        const html = await fetchWithProxy(embedUrl, 'allorigins');
        const caption = extractInstagramCaptionFromHTML(html);
        if (caption) return caption;
    } catch (e) { console.warn('allorigins embed falhou:', e); }

    try {
        const text = await fetchWithProxy(cleanUrl, 'jina');
        const caption = extractInstagramCaptionFromHTML(text);
        if (caption) return caption;
    } catch (e) { console.warn('Jina main falhou:', e); }

    throw new Error('Falha em todas as estratégias de extração.');
}

/**
 * Busca legenda do Facebook
 */
async function fetchFacebookCaption(url) {
    const normalizedUrl = normalizeFacebookUrl(url);

    try {
        const data = await fetchJson(`https://noembed.com/embed?url=${encodeURIComponent(normalizedUrl)}`);
        if (data?.title) {
            const caption = sanitizeCaption(data.title, 'facebook');
            if (caption && caption.length > 2) return caption;
        }
    } catch (e) { console.warn('noembed Facebook falhou:', e); }

    try {
        const text = await fetchWithProxy(normalizedUrl, 'jina');
        const caption = extractFacebookCaptionFromHTML(text);
        if (caption) return caption;
    } catch (e) { console.warn('Jina Facebook falhou:', e); }

    try {
        const html = await fetchWithProxy(normalizedUrl, 'allorigins');
        const caption = extractFacebookCaptionFromHTML(html);
        if (caption) return caption;
    } catch (e) { console.warn('allorigins Facebook falhou:', e); }

    throw new Error('Falha em todas as estratégias de extração do Facebook.');
}

/**
 * Busca o conteúdo de uma URL usando um proxy CORS
 */
async function fetchWithProxy(url, provider) {
    let targetUrl;
    if (provider === 'allorigins') {
        targetUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
    } else if (provider === 'jina') {
        targetUrl = `https://r.jina.ai/${url}`;
    } else {
        throw new Error(`Proxy desconhecido: ${provider}`);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
        const response = await fetch(targetUrl, { signal: controller.signal });
        if (!response.ok) throw new Error(`Erro HTTP ${response.status}`);
        return await response.text();
    } finally {
        clearTimeout(timeout);
    }
}

/**
 * Busca JSON de uma URL pública
 */
async function fetchJson(url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
        const response = await fetch(url, {
            signal: controller.signal,
            headers: { 'Accept': 'application/json' }
        });
        if (!response.ok) throw new Error(`Erro HTTP ${response.status}`);
        return await response.json();
    } finally {
        clearTimeout(timeout);
    }
}

/**
 * Extrai a legenda do HTML/texto do Instagram
 */
function extractInstagramCaptionFromHTML(html) {
    try {
        const embedCaptionMatch = html.match(/class=["']Caption["'][^>]*>\s*<[^>]+>[^<]*<\/[^>]+>([\s\S]*?)<\/div>/i);
        if (embedCaptionMatch?.[1]) {
            const caption = sanitizeCaption(embedCaptionMatch[1], 'instagram');
            if (caption && caption.length > 2) return caption;
        }

        const jinaBlockMatch = html.match(/(?:Caption|Legenda|caption)\s*[:\-]?\s*([\s\S]{10,500}?)(?:\n\n|---|$)/);
        if (jinaBlockMatch?.[1]) {
            const caption = sanitizeCaption(jinaBlockMatch[1].trim(), 'instagram');
            if (caption && caption.length > 5) return caption;
        }

        const ldJsonCaptions = extractCaptionFromLdJson(html);
        if (ldJsonCaptions.length) return ldJsonCaptions[0];

        const edgeMatch = html.match(/"edge_media_to_caption"\s*:\s*\{\s*"edges"\s*:\s*\[\s*\{\s*"node"\s*:\s*\{\s*"text"\s*:\s*"([\s\S]*?)"\s*\}/);
        if (edgeMatch?.[1]) return sanitizeCaption(edgeMatch[1], 'instagram');

        const captionTextMatch = html.match(/"caption_text"\s*:\s*"([\s\S]*?)"/);
        if (captionTextMatch?.[1]) {
            const caption = sanitizeCaption(captionTextMatch[1], 'instagram');
            if (caption && caption.length > 2) return caption;
        }

        const captionMatch = html.match(/"caption"\s*:\s*"([\s\S]*?)"(?=[,}])/);
        if (captionMatch?.[1]) {
            const caption = sanitizeCaption(captionMatch[1], 'instagram');
            if (caption && caption.length > 5) return caption;
        }

        const ogDescription = extractMetaContent(html, 'property', 'og:description');
        if (ogDescription) {
            const cleaned = sanitizeCaption(ogDescription, 'instagram');
            if (cleaned && cleaned.length > 5) return cleaned;
        }

        const description = extractMetaContent(html, 'name', 'description');
        if (description) {
            const cleaned = sanitizeCaption(description, 'instagram');
            if (cleaned && cleaned.length > 5) return cleaned;
        }

        return null;
    } catch (error) {
        console.error('Erro ao extrair legenda do Instagram:', error);
        return null;
    }
}

/**
 * Extrai a legenda do HTML do Facebook
 */
function extractFacebookCaptionFromHTML(html) {
    try {
        const ldJsonCaptions = extractCaptionFromLdJson(html);
        if (ldJsonCaptions.length) return ldJsonCaptions[0];

        const storyMessageMatch = html.match(/"story"\s*:\s*\{[\s\S]*?"message"\s*:\s*\{[\s\S]*?"text"\s*:\s*"([\s\S]*?)"/);
        if (storyMessageMatch?.[1]) {
            const caption = sanitizeCaption(storyMessageMatch[1], 'facebook');
            if (caption && caption.length > 2) return caption;
        }

        const messageTextMatch = html.match(/"message"\s*:\s*\{\s*"text"\s*:\s*"([\s\S]*?)"/);
        if (messageTextMatch?.[1]) {
            const caption = sanitizeCaption(messageTextMatch[1], 'facebook');
            if (caption && caption.length > 2) return caption;
        }

        const ogDescription = extractMetaContent(html, 'property', 'og:description');
        if (ogDescription) {
            const cleaned = sanitizeCaption(ogDescription, 'facebook');
            if (cleaned && cleaned.length > 2) return cleaned;
        }

        const description = extractMetaContent(html, 'name', 'description');
        if (description) {
            const cleaned = sanitizeCaption(description, 'facebook');
            if (cleaned && cleaned.length > 2) return cleaned;
        }

        return null;
    } catch (error) {
        console.error('Erro ao extrair legenda do Facebook:', error);
        return null;
    }
}

/**
 * Extrai legendas de JSON-LD
 */
function extractCaptionFromLdJson(html) {
    const captions = [];
    const matches = [...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)];

    for (const match of matches) {
        const content = match[1]?.trim();
        if (!content) continue;

        try {
            const data = JSON.parse(content);
            const items = Array.isArray(data) ? data : [data];

            for (const item of items) {
                const text = item?.articleBody || item?.description || item?.caption || item?.text;
                const cleaned = sanitizeCaption(text, lastDetectedPlatform || 'instagram');
                if (cleaned && cleaned.length > 2) captions.push(cleaned);
            }
        } catch {
            continue;
        }
    }

    return captions;
}

/**
 * Extrai meta tags
 */
function extractMetaContent(html, attr, attrValue) {
    const regex = new RegExp(`<meta[^>]*${attr}=["']${attrValue}["'][^>]*content=["']([\\s\\S]*?)["'][^>]*>`, 'i');
    const reverseRegex = new RegExp(`<meta[^>]*content=["']([\\s\\S]*?)["'][^>]*${attr}=["']${attrValue}["'][^>]*>`, 'i');
    const match = html.match(regex) || html.match(reverseRegex);
    return match?.[1] ? decodeHTMLEntities(match[1]) : null;
}

/**
 * Normaliza legenda
 */
function sanitizeCaption(text, platform) {
    if (!text) return null;

    let caption = String(text)
        .replace(/<[^>]*>/g, ' ')
        .trim();

    caption = decodeHTMLEntities(decodeUnicodeEscapes(caption))
        .replace(/\s+/g, ' ')
        .trim();

    if (platform === 'instagram') {
        caption = caption
            .replace(/^\d+[,\d\.]*\s+likes?,\s*\d+[,\d\.]*\s+comments?\s*-?\s*/i, '')
            .replace(/^["']|["']$/g, '')
            .replace(/^.*? on Instagram:\s*/i, '')
            .trim();
    }

    if (platform === 'facebook') {
        caption = caption
            .replace(/\s*\|\s*Facebook\s*$/i, '')
            .replace(/^Facebook\s*/i, '')
            .replace(/^No photo description available\.?$/i, '')
            .trim();
    }

    if (!caption) return null;
    if (/^(photo|video|reel)$/i.test(caption)) return null;

    return caption;
}

/**
 * Normaliza URL do Facebook
 */
function normalizeFacebookUrl(url) {
    try {
        const urlObj = new URL(url);
        const hostname = urlObj.hostname.toLowerCase();

        if (hostname.includes('fb.watch')) {
            const watchId = urlObj.pathname.replace(/\//g, '');
            if (watchId) return `https://www.facebook.com/watch/?v=${watchId}`;
        }

        if (hostname.includes('m.facebook.com') || hostname.includes('mbasic.facebook.com')) {
            return `https://www.facebook.com${urlObj.pathname}${urlObj.search}`;
        }

        return `https://www.facebook.com${urlObj.pathname}${urlObj.search}`;
    } catch {
        return url;
    }
}

/**
 * Utilitários de decodificação
 */
function decodeHTMLEntities(text) {
    const textarea = document.createElement('textarea');
    textarea.innerHTML = text;
    return textarea.value;
}

function decodeUnicodeEscapes(text) {
    return text
        .replace(/\\u[\dA-F]{4}/gi, (match) => String.fromCharCode(parseInt(match.replace(/\\u/g, ''), 16)))
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\t/g, '\t')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');
}

/**
 * Interface - Resultados
 */
function showResults(caption) {
    resultContent.textContent = caption || 'Nenhuma legenda encontrada';
    resultSection.classList.remove('hidden');
    if (navigator.share) shareBtn.classList.remove('hidden');
}

async function shareCaption() {
    const text = resultContent.textContent;
    if (!text) return;
    if (navigator.share) {
        try {
            await navigator.share({
                title: `Legenda do ${lastDetectedPlatform === 'facebook' ? 'Facebook' : 'Instagram'}`,
                text: text
            });
        } catch (error) {
            if (error.name !== 'AbortError') {
                console.error('Erro ao compartilhar:', error);
                showError('Erro ao compartilhar. Use o botão Copiar.');
            }
        }
    }
}

function copyToClipboard() {
    const text = resultContent.textContent;
    if (!text) return;

    navigator.clipboard.writeText(text).then(() => {
        const originalText = copyBtn.textContent;
        copyBtn.textContent = '✓ Copiado!';
        copyBtn.style.background = 'var(--success-color)';
        copyBtn.style.color = 'white';
        
        setTimeout(() => {
            copyBtn.textContent = originalText;
            copyBtn.style.background = '';
            copyBtn.style.color = '';
        }, 2000);
    }).catch(() => showError('Erro ao copiar. Tente novamente.'));
}

function clearResults() {
    urlInput.value = '';
    resultSection.classList.add('hidden');
    resultContent.textContent = '';
    urlInput.focus();
}

function showError(message) {
    errorMessage.textContent = message;
    errorSection.classList.remove('hidden');
}

function hideError() {
    errorSection.classList.add('hidden');
}

function hideResults() {
    resultSection.classList.add('hidden');
}

function showLoading(show) {
    if (show) loadingSection.classList.remove('hidden');
    else loadingSection.classList.add('hidden');
}

window.addEventListener('load', () => {
    urlInput.focus();
    initLightfall();
});

// ==========================================
// EFEITO BACKGROUND: LIGHTFALL (CANVAS)
// ==========================================
function initLightfall() {
    const canvas = document.getElementById('lightfallCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    let width, height;
    const colors = ["#A6C8FF", "#5227FF", "#FF9FFC"];
    const density = 0.6; 
    const speedBase = 0.5;
    const mouseInteraction = true;
    const mouseRadius = 150;
    const mouseStrength = 0.5;
    
    let particles = [];
    let mouse = { x: null, y: null };
    let lastWidth = window.innerWidth;

    function resize() {
        width = window.innerWidth;
        height = window.innerHeight;
        canvas.width = width;
        canvas.height = height;
        createParticles();
    }

    window.addEventListener('mousemove', (e) => {
        mouse.x = e.x;
        mouse.y = e.y;
    });

    window.addEventListener('mouseout', () => {
        mouse.x = null;
        mouse.y = null;
    });

    window.addEventListener('resize', () => {
        // Trava para o canvas só reiniciar se a tela mudar de largura no mobile
        if (window.innerWidth !== lastWidth) {
            lastWidth = window.innerWidth;
            resize();
        }
    });

    class Streak {
        constructor() {
            this.x = Math.random() * width;
            this.y = Math.random() * height;
            this.length = Math.random() * 80 + 20; 
            this.speed = (Math.random() * 2 + 1) * speedBase;
            this.width = Math.random() * 2 + 0.5; 
            this.color = colors[Math.floor(Math.random() * colors.length)];
            this.glow = 15; 
            this.opacity = Math.random() * 0.5 + 0.3;
        }

        draw() {
            ctx.beginPath();
            ctx.moveTo(this.x, this.y);
            ctx.lineTo(this.x, this.y + this.length);
            ctx.strokeStyle = this.color;
            ctx.lineWidth = this.width;
            ctx.globalAlpha = this.opacity;
            ctx.shadowBlur = this.glow;
            ctx.shadowColor = this.color;
            ctx.stroke();
            ctx.globalAlpha = 1.0;
            ctx.shadowBlur = 0;
        }

        update() {
            if (mouseInteraction && mouse.x != null && mouse.y != null) {
                let dx = mouse.x - this.x;
                let dy = mouse.y - (this.y + this.length / 2);
                let distance = Math.sqrt(dx * dx + dy * dy);
                
                if (distance < mouseRadius) {
                    const forceDirectionX = dx / distance;
                    const force = (mouseRadius - distance) / mouseRadius;
                    const direction = forceDirectionX * force * mouseStrength * 5;
                    this.x -= direction;
                }
            }

            this.y += this.speed;

            if (this.y > height) {
                this.y = -this.length;
                this.x = Math.random() * width;
            }

            this.draw();
        }
    }

    function createParticles() {
        particles = [];
        const numParticles = Math.floor((width * height) / 10000 * density);
        for (let i = 0; i < numParticles; i++) {
            particles.push(new Streak());
        }
    }

    function animate() {
        requestAnimationFrame(animate);
        
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.fillRect(0, 0, width, height);
        ctx.globalCompositeOperation = 'source-over';

        particles.forEach(p => p.update());
    }

    resize();
    animate();
}