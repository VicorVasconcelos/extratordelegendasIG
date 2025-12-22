
const API_BASE = 'https://www.instagram.com';

// Elementos
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

// Event
extractBtn.addEventListener('click', extractCaption);
urlInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') extractCaption();
});
copyBtn.addEventListener('click', copyToClipboard);
shareBtn.addEventListener('click', shareCaption);
clearBtn.addEventListener('click', clearResults);

/**
 * Extrai a legenda do Instagram usando a API
 */
async function extractCaption() {
    const url = urlInput.value.trim();

    // Validações
    if (!url) {
        showError('Por favor, insira um link do Instagram');
        return;
    }

    if (!isValidInstagramUrl(url)) {
        showError('Link inválido. Cole um link válido do Instagram (ex: https://www.instagram.com/p/...)');
        return;
    }

    showLoading(true);
    hideError();
    hideResults();

    try {
        const caption = await fetchCaptionFromInstagram(url);
        showResults(caption);
    } catch (error) {
        console.error('Erro:', error);
        showError(`Erro ao extrair legenda: ${error.message}`);
    } finally {
        showLoading(false);
    }
}

/**
 * Valida se a URL é um link válido do Instagram
 */
function isValidInstagramUrl(url) {
    try {
        const urlObj = new URL(url);
        const isInstagram = urlObj.hostname.includes('instagram.com');
        
        // Valida se é um tipo válido de post do Instagram
        const validPatterns = /\/(p|reel|reels|tv|stories)\//;
        
        return isInstagram && validPatterns.test(url);
    } catch {
        return false;
    }
}

/**
 * Extrai o ID do post/reel/IGTV do Instagram
 */
function extractPostId(url) {
    // Suporta /p/ (posts), /reel/ (reels), /tv/ (IGTV), /stories/ (stories)
    const match = url.match(/\/(p|reel|reels|tv|stories)\/([a-zA-Z0-9_-]+)/);
    return match ? match[2] : null;
}

/**
 * Busca a legenda do Instagram usando web scraping
 */
async function fetchCaptionFromInstagram(url) {
    try {
        const postId = extractPostId(url);
        if (!postId) {
            throw new Error('Não foi possível extrair o ID do post');
        }

        // Normalizar URL para formato padrão
        const normalizedUrl = `https://www.instagram.com/p/${postId}/`;
        
        // Tentar outros métodos
        return await extractCaptionWithProxy(normalizedUrl);

    } catch (error) {
        throw new Error(`Falha na extração: ${error.message}`);
    }
}

/**
 * Extrai legenda usando proxy CORS
 */
async function extractCaptionWithProxy(url) {
    // Usar AllOrigins como proxy CORS
    const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
    
    try {
        const response = await fetch(proxyUrl);
        
        if (!response.ok) {
            throw new Error('Erro ao buscar dados do Instagram');
        }
        
        const html = await response.text();
        
        // Extrair legenda do HTML usando regex
        const caption = extractCaptionFromHTML(html);
        
        if (!caption) {
            throw new Error('Legenda não encontrada neste post');
        }
        
        return caption;
        
    } catch (error) {
        console.error('Erro no proxy:', error);
        throw new Error('Não foi possível extrair a legenda. O Instagram pode ter bloqueado o acesso.');
    }
}

/**
 * Extrai a legenda do HTML do Instagram
 */
function extractCaptionFromHTML(html) {
    try {
        // Método 1: Buscar no JSON embutido do Instagram (dados estruturados)
        const scriptMatch = html.match(/<script type="application\/ld\+json">(.+?)<\/script>/s);
        if (scriptMatch && scriptMatch[1]) {
            try {
                const data = JSON.parse(scriptMatch[1]);
                if (data.articleBody) {
                    const caption = data.articleBody;
                    // Remover informações de likes e comments se existirem
                    const cleanCaption = caption.replace(/^\d+[,\d]* likes?,\s*\d+[,\d]* comments?\s*-?\s*/i, '').trim();
                    if (cleanCaption && cleanCaption.length > 10) {
                        return cleanCaption;
                    }
                }
            } catch (e) {
                console.error('Erro ao parsear JSON LD:', e);
            }
        }
        
        // Método 2: Buscar por "edge_media_to_caption" no JSON do React
        const captionDataMatch = html.match(/"edge_media_to_caption":\s*\{"edges":\s*\[\s*\{"node":\s*\{"text":\s*"([^"]+)"/);
        if (captionDataMatch && captionDataMatch[1]) {
            return decodeUnicodeEscapes(captionDataMatch[1]);
        }
        
        // Método 3: Buscar por "caption" no JSON
        const captionMatch = html.match(/"caption":\s*"([^"]+)"/);
        if (captionMatch && captionMatch[1]) {
            const caption = decodeUnicodeEscapes(captionMatch[1]);
            if (caption.length > 10 && !caption.match(/^\d+.*likes/i)) {
                return caption;
            }
        }
        
        // Método 4: Meta tag og:description (limpar estatísticas)
        let match = html.match(/<meta property="og:description" content="([^"]+)"/);
        if (match && match[1]) {
            const text = decodeHTMLEntities(match[1]);
            // Extrair apenas a legenda, removendo likes/comments
            const parts = text.split('" on Instagram:');
            if (parts.length > 1) {
                return parts[1].trim().replace(/^:\s*/, '');
            }
            // Tentar remover padrão "X likes, Y comments - Caption"
            const cleanText = text.replace(/^\d+[,\d]*\s+likes?,\s*\d+[,\d]*\s+comments?\s*-?\s*/i, '').trim();
            if (cleanText && !cleanText.match(/^(Photo|Video|Reel)/i)) {
                return cleanText;
            }
        }
        
        return null;
        
    } catch (error) {
        console.error('Erro ao extrair do HTML:', error);
        return null;
    }
}

/**
 * Decodifica HTML entities
 */
function decodeHTMLEntities(text) {
    const textarea = document.createElement('textarea');
    textarea.innerHTML = text;
    return textarea.value;
}

/**
 * Decodifica escapes Unicode
 */
function decodeUnicodeEscapes(text) {
    return text.replace(/\\u[\dA-F]{4}/gi, (match) => {
        return String.fromCharCode(parseInt(match.replace(/\\u/g, ''), 16));
    });
}

/**
 * Exibe a seção de resultados
 */
function showResults(caption) {
    resultContent.textContent = caption || 'Nenhuma legenda encontrada';
    resultSection.classList.remove('hidden');
    
    // Mostrar botão de compartilhar se a API estiver disponível
    if (navigator.share) {
        shareBtn.classList.remove('hidden');
    }
}

/**
 * Compartilha a legenda (apenas mobile)
 */
async function shareCaption() {
    const text = resultContent.textContent;
    
    if (!text) return;

    if (navigator.share) {
        try {
            await navigator.share({
                title: 'Legenda do Instagram',
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

/**
 * Copia a legenda para a área de transferência
 */
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
    }).catch(() => {
        showError('Erro ao copiar. Tente novamente.');
    });
}

/**
 * Limpa os resultados
 */
function clearResults() {
    urlInput.value = '';
    resultSection.classList.add('hidden');
    resultContent.textContent = '';
    urlInput.focus();
}

/**
 * Exibe mensagem de erro
 */
function showError(message) {
    errorMessage.textContent = message;
    errorSection.classList.remove('hidden');
}

/**
 * Oculta mensagem de erro
 */
function hideError() {
    errorSection.classList.add('hidden');
}

/**
 * Oculta resultados
 */
function hideResults() {
    resultSection.classList.add('hidden');
}

/**
 * Exibe/oculta seção de carregamento
 */
function showLoading(show) {
    if (show) {
        loadingSection.classList.remove('hidden');
    } else {
        loadingSection.classList.add('hidden');
    }
}
window.addEventListener('load', () => {
    urlInput.focus();
});
