/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GoogleGenAI, Modality, Part } from "@google/genai";

// --- DOM Element References ---
const sketchUploadInput = document.getElementById('sketch-upload-input') as HTMLInputElement;
const sketchPreview = document.getElementById('sketch-preview') as HTMLImageElement;
const sketchCanvas = document.getElementById('sketch-canvas') as HTMLCanvasElement;
const clearCanvasBtn = document.getElementById('clear-canvas') as HTMLButtonElement;
const modelUploadInput = document.getElementById('model-upload-input') as HTMLInputElement;
const modelPreview = document.getElementById('model-preview') as HTMLImageElement;
const modelTypeSelect = document.getElementById('model-type') as HTMLSelectElement;
const designDescription = document.getElementById('design-description') as HTMLTextAreaElement;
const realismSlider = document.getElementById('realism-slider') as HTMLInputElement;
const realismValue = document.getElementById('realism-value') as HTMLSpanElement;
const generateBtn = document.getElementById('generate-btn') as HTMLButtonElement;
const displayPanel = document.getElementById('display-panel') as HTMLElement;
const placeholder = document.getElementById('placeholder') as HTMLElement;
const loading = document.getElementById('loading') as HTMLElement;
const resultImage = document.getElementById('result-image') as HTMLImageElement;

// --- State Management ---
let sketchFile: File | null = null;
let modelFile: File | null = null;
let isDrawing = false;
let hasDrawn = false;
const ctx = sketchCanvas.getContext('2d')!;
ctx.strokeStyle = '#000';
ctx.lineWidth = 2;
ctx.lineCap = 'round';

// --- Utility Functions ---
async function fileToGenerativePart(file: File): Promise<Part> {
    const base64EncodedDataPromise = new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
        reader.readAsDataURL(file);
    });
    return {
        inlineData: {
            data: await base64EncodedDataPromise,
            mimeType: file.type
        },
    };
}

function canvasToGenerativePart(canvas: HTMLCanvasElement): Part {
    const dataUrl = canvas.toDataURL('image/png');
    const base64Data = dataUrl.split(',')[1];
    return {
        inlineData: {
            data: base64Data,
            mimeType: 'image/png'
        },
    };
}

function updateUIState() {
    // Sketch input: only one can be active
    if (sketchFile) {
        sketchCanvas.parentElement!.classList.add('disabled');
    } else {
        sketchCanvas.parentElement!.classList.remove('disabled');
    }

    if (hasDrawn) {
        sketchUploadInput.parentElement!.classList.add('disabled');
    } else {
        sketchUploadInput.parentElement!.classList.remove('disabled');
    }

    // Model input: file upload disables dropdown
    if (modelFile) {
        modelTypeSelect.classList.add('disabled');
    } else {
        modelTypeSelect.classList.remove('disabled');
    }
}

// --- Event Listeners ---

// Sketch Upload
sketchUploadInput.addEventListener('change', () => {
    if (sketchUploadInput.files && sketchUploadInput.files[0]) {
        sketchFile = sketchUploadInput.files[0];
        sketchPreview.src = URL.createObjectURL(sketchFile);
        sketchPreview.style.display = 'block';
        clearCanvas();
        updateUIState();
    }
});

// Model Upload
modelUploadInput.addEventListener('change', () => {
    if (modelUploadInput.files && modelUploadInput.files[0]) {
        modelFile = modelUploadInput.files[0];
        modelPreview.src = URL.createObjectURL(modelFile);
        modelPreview.style.display = 'block';
        updateUIState();
    }
});

// Realism Slider
realismSlider.addEventListener('input', () => {
    realismValue.textContent = `${realismSlider.value}%`;
});


// Canvas Drawing
function getPosition(event: MouseEvent | TouchEvent) {
    const rect = sketchCanvas.getBoundingClientRect();
    const scaleX = sketchCanvas.width / rect.width;
    const scaleY = sketchCanvas.height / rect.height;

    if (event instanceof MouseEvent) {
        return {
            x: (event.clientX - rect.left) * scaleX,
            y: (event.clientY - rect.top) * scaleY
        };
    } else { // TouchEvent
        return {
            x: (event.touches[0].clientX - rect.left) * scaleX,
            y: (event.touches[0].clientY - rect.top) * scaleY
        };
    }
}

function startDrawing(e: MouseEvent | TouchEvent) {
    if (sketchFile) return;
    isDrawing = true;
    hasDrawn = true;
    updateUIState();
    const pos = getPosition(e);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    e.preventDefault();
}

function draw(e: MouseEvent | TouchEvent) {
    if (!isDrawing || sketchFile) return;
    const pos = getPosition(e);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    e.preventDefault();
}

function stopDrawing() {
    isDrawing = false;
}

sketchCanvas.addEventListener('mousedown', startDrawing);
sketchCanvas.addEventListener('mousemove', draw);
sketchCanvas.addEventListener('mouseup', stopDrawing);
sketchCanvas.addEventListener('mouseleave', stopDrawing);

sketchCanvas.addEventListener('touchstart', startDrawing, { passive: false });
sketchCanvas.addEventListener('touchmove', draw, { passive: false });
sketchCanvas.addEventListener('touchend', stopDrawing);


function clearCanvas() {
    ctx.clearRect(0, 0, sketchCanvas.width, sketchCanvas.height);
    hasDrawn = false;
    // Also reset sketch file if user decides to draw after uploading
    sketchFile = null;
    sketchUploadInput.value = '';
    sketchPreview.style.display = 'none';
    updateUIState();
}
clearCanvasBtn.addEventListener('click', clearCanvas);


// --- Main Generation Logic ---

async function handleGenerateClick() {
    if (!sketchFile && !hasDrawn) {
        alert('Please upload or draw a sketch.');
        return;
    }

    // 1. Set loading state
    generateBtn.disabled = true;
    placeholder.classList.add('hidden');
    resultImage.classList.add('hidden');
    loading.classList.remove('hidden');

    try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });

        const parts: Part[] = [];

        // 2. Add sketch part (prioritize uploaded file)
        if (sketchFile) {
            parts.push(await fileToGenerativePart(sketchFile));
        } else if (hasDrawn) {
            parts.push(canvasToGenerativePart(sketchCanvas));
        }

        // 3. Add model part (if available)
        if (modelFile) {
            parts.push(await fileToGenerativePart(modelFile));
        }

        // 4. Construct and add text prompt part
        const modelInfo = modelFile ? 'the uploaded model' : `a ${modelTypeSelect.value} model`;
        const userDescription = designDescription.value || 'a stunning fashion design';
        const realism = realismSlider.value;
        
        const textPrompt = `
          Transform the provided clothing sketch into a hyperrealistic, photorealistic runway photo.
          Have ${modelInfo} wear this design.
          Render the fabric, shimmer, style, and other details exactly as described in the following text: "${userDescription}".
          The realism level must be ${realism}%.
          Ensure the final image looks like high-quality professional photography, not an AI-generated image.
          The output must be a single, cohesive, photorealistic image of the new design on the model.
        `;
        parts.push({ text: textPrompt });

        // 5. Make the API call
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash-image-preview',
            contents: { parts },
            config: {
                responseModalities: [Modality.IMAGE, Modality.TEXT],
            },
        });

        // 6. Process the response
        let imageFound = false;
        for (const part of response.candidates?.[0]?.content?.parts ?? []) {
          if (part.inlineData) {
            const base64ImageBytes: string = part.inlineData.data;
            resultImage.src = `data:${part.inlineData.mimeType};base64,${base64ImageBytes}`;
            resultImage.classList.remove('hidden');
            imageFound = true;
            break; 
          }
        }
        if (!imageFound) {
            throw new Error("API response did not contain an image.");
        }

    } catch (error) {
        console.error(error);
        placeholder.classList.remove('hidden');
        placeholder.innerHTML = `<p style="color: red;">An error occurred. Please try again.<br><small>${(error as Error).message}</small></p>`;
    } finally {
        // 7. Reset UI state
        loading.classList.add('hidden');
        generateBtn.disabled = false;
    }
}

generateBtn.addEventListener('click', handleGenerateClick);

// Initial UI setup
updateUIState();
