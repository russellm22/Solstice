'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';

// Dynamically import react-pdf to avoid SSR issues
const Document = dynamic(
  () => import('react-pdf').then((mod) => mod.Document),
  { ssr: false }
);

const Page = dynamic(
  () => import('react-pdf').then((mod) => mod.Page),
  { ssr: false }
);

// Import CSS
import 'react-pdf/dist/esm/Page/AnnotationLayer.css';
import 'react-pdf/dist/esm/Page/TextLayer.css';

export default function Home() {
  // Prevent hydration mismatch
  const [isMounted, setIsMounted] = useState(false);
  
  useEffect(() => {
    setIsMounted(true);
  }, []);

  const [file, setFile] = useState<File | null>(null);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [numPages, setNumPages] = useState<number>(0);
  const [pageNumber, setPageNumber] = useState<number>(1);
  const [scale, setScale] = useState<number>(1.0);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragOver, setIsDragOver] = useState(false);
  const [isPdfReady, setIsPdfReady] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editingElement, setEditingElement] = useState<HTMLElement | null>(null);
  const [editingText, setEditingText] = useState<string>('');
  const [editingPosition, setEditingPosition] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [editingStyles, setEditingStyles] = useState<CSSStyleDeclaration | null>(null);
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [editedRegions, setEditedRegions] = useState<Array<{ x: number; y: number; width: number; height: number; page: number }>>([]);
  const [annotationMode, setAnnotationMode] = useState<'none' | 'highlight' | 'note' | 'textbox' | 'redact'>('none');
  const [annotations, setAnnotations] = useState<Array<{
    id: string;
    type: 'highlight' | 'note' | 'textbox' | 'redact';
    page: number;
    x: number;
    y: number;
    width: number;
    height: number;
    color?: string;
    text?: string;
  }>>([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [currentAnnotation, setCurrentAnnotation] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [versions, setVersions] = useState<Array<{
    id: string;
    version: number;
    message: string;
    timestamp: Date;
    pdfData: ArrayBuffer;
    pdfDoc: any;
    annotations?: Array<{
      id: string;
      type: 'highlight' | 'note' | 'textbox' | 'redact';
      page: number;
      x: number;
      y: number;
      width: number;
      height: number;
      color?: string;
      text?: string;
    }>;
  }>>([]);
  const [currentVersion, setCurrentVersion] = useState<number>(1);
  const [showCommitModal, setShowCommitModal] = useState(false);
  const [commitMessage, setCommitMessage] = useState('');
  const [diffMode, setDiffMode] = useState(false);
  const [diffVersions, setDiffVersions] = useState<{ v1: number | null; v2: number | null }>({ v1: null, v2: null });
  const [textDiffs, setTextDiffs] = useState<Array<{
    type: 'added' | 'deleted' | 'modified';
    text: string;
    x: number;
    y: number;
    width: number;
    height: number;
    page?: number; // Optional page number for annotation diffs
    isAnnotation?: boolean; // Flag to distinguish annotation diffs
  }>>([]);
  const [diffsReady, setDiffsReady] = useState(false);
  const pageContainerRef = useRef<HTMLDivElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  const annotationCanvasRef = useRef<HTMLCanvasElement>(null);

  // Set up PDF.js worker on client side
  useEffect(() => {
    if (typeof window !== 'undefined') {
      import('react-pdf').then((mod) => {
        // Use local worker file (version 4.x uses .mjs format)
        // This ensures version compatibility and avoids CDN issues
        mod.pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
        setIsPdfReady(true);
      });
    }
  }, []);

  const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
    setPageNumber(1);
  };

  const loadPdfWithLib = async (file: File) => {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const { PDFDocument } = await import('pdf-lib');
      const pdfDoc = await PDFDocument.load(arrayBuffer);
      setPdfDoc(pdfDoc);
      
      // Create initial version (V1)
      const initialVersion = {
        id: `version-${Date.now()}`,
        version: 1,
        message: 'Initial version',
        timestamp: new Date(),
        pdfData: arrayBuffer,
        pdfDoc: pdfDoc,
        annotations: [],
      };
      setVersions([initialVersion]);
      setCurrentVersion(1);
      
      // Clear edited regions when loading new PDF
      setEditedRegions([]);
      
      return pdfDoc;
    } catch (error) {
      console.error('Error loading PDF with pdf-lib:', error);
      return null;
    }
  };

  const commitVersion = async () => {
    if (!pdfDoc || !fileUrl) return;
    
    try {
      // Get current PDF bytes - ensure we're saving the latest state
      console.log('Committing version - saving current PDF state...');
      const pdfBytes = await pdfDoc.save();
      const arrayBuffer = pdfBytes.buffer;
      
      // Verify the array buffer size
      console.log('Committed PDF size:', arrayBuffer.byteLength, 'bytes');
      
      // Reload PDF document for the new version
      const { PDFDocument } = await import('pdf-lib');
      const newPdfDoc = await PDFDocument.load(arrayBuffer);
      
      // Create a copy of the ArrayBuffer to ensure it's not shared
      const pdfDataCopy = arrayBuffer.slice(0);
      
      // Create new version with current annotations
      const newVersion = {
        id: `version-${Date.now()}`,
        version: currentVersion + 1,
        message: commitMessage || `Version ${currentVersion + 1}`,
        timestamp: new Date(),
        pdfData: pdfDataCopy, // Use copy to ensure it's independent
        pdfDoc: newPdfDoc,
        annotations: [...annotations], // Store annotations for this version
      };
      
      console.log('Created version V' + newVersion.version + ' with PDF data size:', pdfDataCopy.byteLength);
      
      // Add to versions list
      setVersions([...versions, newVersion]);
      setCurrentVersion(newVersion.version);
      
      // Update current PDF
      setPdfDoc(newPdfDoc);
      
      // Update file URL
      if (fileUrl) {
        URL.revokeObjectURL(fileUrl);
      }
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const newUrl = URL.createObjectURL(blob);
      setFileUrl(newUrl);
      
      const newFile = new File([blob], file?.name || 'versioned.pdf', { type: 'application/pdf' });
      setFile(newFile);
      
      // Close modal and reset message
      setShowCommitModal(false);
      setCommitMessage('');
      
    } catch (error) {
      console.error('Error committing version:', error);
      alert('Failed to commit version. Please try again.');
    }
  };

  // Export annotated PDF with change log and callouts
  const exportAnnotatedPdf = async () => {
    if (versions.length === 0) {
      alert('No versions to export. Please create at least one version.');
      return;
    }

    try {
      const { PDFDocument, rgb, StandardFonts } = await import('pdf-lib');
      const exportedPdf = await PDFDocument.create();
      
      // Get the latest version (highest version number)
      const latestVersion = versions.reduce((prev, current) => 
        (current.version > prev.version) ? current : prev
      );
      
      // Load the latest version PDF
      const sourcePdf = await PDFDocument.load(latestVersion.pdfData);
      
      // Create fonts
      const helveticaFont = await exportedPdf.embedFont(StandardFonts.Helvetica);
      const helveticaBoldFont = await exportedPdf.embedFont(StandardFonts.HelveticaBold);
      
      // Copy all pages from latest version first
      const pageIndices = sourcePdf.getPageIndices();
      for (let i = 0; i < pageIndices.length; i++) {
        const [copiedPage] = await exportedPdf.copyPages(sourcePdf, [i]);
        exportedPdf.addPage(copiedPage);
      }
      
      // Create Change Log page (will insert at front after drawing)
      const changeLogPage = exportedPdf.insertPage(0, [612, 792]); // Letter size, inserted at beginning
      const { width, height } = changeLogPage.getSize();
      
      // Title
      changeLogPage.drawText('Change Log', {
        x: 50,
        y: height - 50,
        size: 24,
        font: helveticaBoldFont,
        color: rgb(0, 0, 0),
      });
      
      // Version entries
      let yPos = height - 100;
      const lineHeight = 60;
      const margin = 50;
      const contentWidth = width - (margin * 2);
      let currentChangeLogPage = changeLogPage;
      let changeLogPageIndex = 0;
      
      versions.forEach((version, index) => {
        if (yPos < 100) {
          // Add new continuation page right after current change log page
          const newPage = exportedPdf.insertPage(changeLogPageIndex + 1, [612, 792]);
          currentChangeLogPage.drawText('(continued)', {
            x: margin,
            y: 50,
            size: 10,
            font: helveticaFont,
            color: rgb(0.5, 0.5, 0.5),
          });
          currentChangeLogPage = newPage;
          changeLogPageIndex++;
          yPos = height - 50;
        }
        
        // Version number and date
        const versionText = `V${version.version}`;
        const dateText = version.timestamp.toLocaleDateString() + ' ' + version.timestamp.toLocaleTimeString();
        
        currentChangeLogPage.drawText(versionText, {
          x: margin,
          y: yPos,
          size: 14,
          font: helveticaBoldFont,
          color: rgb(0, 0, 0),
        });
        
        currentChangeLogPage.drawText(dateText, {
          x: margin + 80,
          y: yPos,
          size: 10,
          font: helveticaFont,
          color: rgb(0.5, 0.5, 0.5),
        });
        
        // Message (wrap text)
        const messageLines = wrapText(version.message, contentWidth - 100, helveticaFont, 10);
        messageLines.forEach((line, lineIndex) => {
          currentChangeLogPage.drawText(line, {
            x: margin + 20,
            y: yPos - 20 - (lineIndex * 12),
            size: 10,
            font: helveticaFont,
            color: rgb(0, 0, 0),
          });
        });
        
        // List annotations
        const annotationCount = version.annotations?.length || 0;
        let annotationYPos = yPos - 20 - (messageLines.length * 12) - 5;
        
        if (annotationCount > 0) {
          currentChangeLogPage.drawText(`Annotations (${annotationCount}):`, {
            x: margin + 20,
            y: annotationYPos,
            size: 9,
            font: helveticaBoldFont,
            color: rgb(0.3, 0.3, 0.3),
          });
          annotationYPos -= 12;
          
          version.annotations?.forEach((annotation, annIndex) => {
            // Check if we need a new page for annotations
            if (annotationYPos < 80) {
              const newPage = exportedPdf.insertPage(changeLogPageIndex + 1, [612, 792]);
              currentChangeLogPage.drawText('(continued)', {
                x: margin,
                y: 50,
                size: 10,
                font: helveticaFont,
                color: rgb(0.5, 0.5, 0.5),
              });
              currentChangeLogPage = newPage;
              changeLogPageIndex++;
              annotationYPos = height - 50;
            }
            
            const annotationLabel = `  • V${version.version}-#${annIndex + 1}: ${getAnnotationTypeLabel(annotation.type)}`;
            const annotationDetails = annotation.text 
              ? ` (Page ${annotation.page}, "${annotation.text.substring(0, 30)}${annotation.text.length > 30 ? '...' : ''}")`
              : ` (Page ${annotation.page})`;
            
            // Draw annotation label
            currentChangeLogPage.drawText(annotationLabel, {
              x: margin + 30,
              y: annotationYPos,
              size: 8,
              font: helveticaFont,
              color: rgb(0.2, 0.2, 0.2),
            });
            
            // Draw annotation details on next line if there's text
            if (annotation.text) {
              annotationYPos -= 10;
              const detailsLines = wrapText(annotationDetails, contentWidth - 120, helveticaFont, 8);
              detailsLines.forEach((line, lineIdx) => {
                currentChangeLogPage.drawText(line, {
                  x: margin + 40,
                  y: annotationYPos - (lineIdx * 10),
                  size: 8,
                  font: helveticaFont,
                  color: rgb(0.4, 0.4, 0.4),
                });
              });
              annotationYPos -= (detailsLines.length * 10);
            }
            
            annotationYPos -= 8;
          });
        }
        
        yPos = annotationYPos - 20;
      });
      
      // Add callouts to pages based on version annotations
      versions.forEach((version) => {
        if (!version.annotations || version.annotations.length === 0) return;
        
        version.annotations.forEach((annotation, annIndex) => {
          // Page numbers are 1-indexed, but PDF pages are 0-indexed
          // Account for the change log page at index 0
          const targetPageIndex = annotation.page; // This is 1-indexed from the original PDF
          const exportedPageIndex = targetPageIndex; // After inserting change log, original pages start at index 1
          
          if (exportedPageIndex < exportedPdf.getPageCount()) {
            const page = exportedPdf.getPage(exportedPageIndex);
            const { width: pageWidth, height: pageHeight } = page.getSize();
            
            // Convert annotation coordinates (screen pixels) to PDF coordinates
            // We need to get the scale factor - assume standard PDF page size
            const scaleX = pageWidth / 612; // Assuming original was rendered at 612px width
            const scaleY = pageHeight / 792; // Assuming original was rendered at 792px height
            
            // Annotation coordinates are relative to page element, need to convert
            const pdfX = annotation.x * scaleX;
            const pdfY = pageHeight - (annotation.y * scaleY); // PDF Y is bottom-up
            
            // Draw callout box
            const calloutText = `V${version.version}-#${annIndex + 1}: ${getAnnotationTypeLabel(annotation.type)}`;
            const textWidth = helveticaFont.widthOfTextAtSize(calloutText, 8);
            const boxWidth = textWidth + 10;
            const boxHeight = 15;
            
            // Draw background
            page.drawRectangle({
              x: pdfX,
              y: pdfY - boxHeight,
              width: boxWidth,
              height: boxHeight,
              color: rgb(1, 1, 0.8), // Light yellow
              opacity: 0.9,
            });
            
            // Draw border
            page.drawRectangle({
              x: pdfX,
              y: pdfY - boxHeight,
              width: boxWidth,
              height: boxHeight,
              borderColor: rgb(0, 0, 0),
              borderWidth: 0.5,
            });
            
            // Draw text
            page.drawText(calloutText, {
              x: pdfX + 5,
              y: pdfY - 12,
              size: 8,
              font: helveticaFont,
              color: rgb(0, 0, 0),
            });
          }
        });
      });
      
      // Save and download
      const pdfBytes = await exportedPdf.save();
      const blob = new Blob([new Uint8Array(pdfBytes)], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = file?.name ? `annotated_${file.name}` : 'annotated_document.pdf';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      
      alert('Annotated PDF exported successfully!');
    } catch (error) {
      console.error('Error exporting annotated PDF:', error);
      alert('Failed to export annotated PDF. Please try again.');
    }
  };
  
  // Helper function to wrap text
  const wrapText = (text: string, maxWidth: number, font: any, fontSize: number): string[] => {
    const words = text.split(' ');
    const lines: string[] = [];
    let currentLine = '';
    
    words.forEach((word) => {
      const testLine = currentLine + (currentLine ? ' ' : '') + word;
      const testWidth = font.widthOfTextAtSize(testLine, fontSize);
      
      if (testWidth > maxWidth && currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    });
    
    if (currentLine) {
      lines.push(currentLine);
    }
    
    return lines;
  };
  
  // Helper function to get annotation type label
  const getAnnotationTypeLabel = (type: string): string => {
    switch (type) {
      case 'highlight': return 'Highlight';
      case 'note': return 'Sticky Note';
      case 'textbox': return 'Text Box';
      case 'redact': return 'Redaction';
      default: return 'Annotation';
    }
  };

  const switchVersion = async (versionNumber: number) => {
    const version = versions.find(v => v.version === versionNumber);
    if (!version) return;
    
    try {
      // Load the version's PDF
      const { PDFDocument } = await import('pdf-lib');
      const versionPdfDoc = await PDFDocument.load(version.pdfData);
      
      // Update current PDF
      setPdfDoc(versionPdfDoc);
      setCurrentVersion(versionNumber);
      
      // Clear edited regions when switching versions (each version has its own edits)
      setEditedRegions([]);
      
      // Update file URL
      if (fileUrl) {
        URL.revokeObjectURL(fileUrl);
      }
      const blob = new Blob([version.pdfData], { type: 'application/pdf' });
      const newUrl = URL.createObjectURL(blob);
      setFileUrl(newUrl);
      
      const newFile = new File([blob], file?.name || `version-${versionNumber}.pdf`, { type: 'application/pdf' });
      setFile(newFile);
      
      // Clear diff mode if switching versions
      if (diffMode) {
        setDiffMode(false);
        setTextDiffs([]);
        setDiffsReady(false);
      }
      
    } catch (error) {
      console.error('Error switching version:', error);
      alert('Failed to switch version. Please try again.');
    }
  };

  // Extract text from PDF using pdf-lib (more reliable than DOM extraction)
  const extractTextFromPdfLib = async (pdfData: ArrayBuffer, pageNum: number): Promise<string> => {
    try {
      const { PDFDocument } = await import('pdf-lib');
      const pdfDoc = await PDFDocument.load(pdfData);
      const page = pdfDoc.getPage(pageNum - 1);
      
      // Get text content from the page
      // Note: pdf-lib doesn't have built-in text extraction, so we'll use the DOM method
      // but with better waiting logic
      return '';
    } catch (error) {
      console.error('Error extracting text with pdf-lib:', error);
      return '';
    }
  };

  // Extract text from currently rendered PDF (improved version)
  const extractTextFromCurrentPdf = async (expectedUrl?: string): Promise<Array<{
    text: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }>> => {
    // Ensure we're on client side
    if (typeof window === 'undefined' || !pageContainerRef.current) {
      return [];
    }
    
    // Wait for PDF page and text layer to be fully rendered
    // Also verify the PDF URL matches what we expect
    let textLayer = null;
    let pageElement = null;
    let attempts = 0;
    const maxAttempts = 40; // Wait up to 8 seconds
    
    while (attempts < maxAttempts) {
      pageElement = pageContainerRef.current?.querySelector('.react-pdf__Page');
      textLayer = pageContainerRef.current?.querySelector('.react-pdf__Page__textContent');
      
      // Check if text layer has content
      if (textLayer && pageElement) {
        const spans = textLayer.querySelectorAll('span');
        if (spans.length > 0) {
          // Verify the PDF has actually loaded by checking if we can get text
          const firstSpan = spans[0];
          if (firstSpan.textContent) {
            break; // Found text layer with content
          }
        }
      }
      
      await new Promise(resolve => setTimeout(resolve, 200));
      attempts++;
    }
    
    if (!textLayer || !pageElement) {
      console.warn('Text layer or page element not found after waiting');
      return [];
    }
    
    const textSpans = textLayer.querySelectorAll('span');
    if (textSpans.length === 0) {
      console.warn('No text spans found in text layer');
      return [];
    }
    
    const textData: Array<{ text: string; x: number; y: number; width: number; height: number }> = [];
    const pageRect = pageElement.getBoundingClientRect();
    const containerRect = pageContainerRef.current.getBoundingClientRect();
    
    if (!pageRect || !containerRect) return [];
    
    // Get all text to verify we're extracting from the right PDF
    let fullText = '';
    textSpans.forEach((span) => {
      const rect = span.getBoundingClientRect();
      const text = span.textContent || '';
      if (text.trim()) { // Only include non-empty text
        fullText += text + ' ';
        // Store coordinates relative to the page element (not container)
        // This makes it easier to position highlights correctly
        textData.push({
          text: text,
          x: rect.left - pageRect.left,
          y: rect.top - pageRect.top,
          width: rect.width,
          height: rect.height,
        });
      }
    });
    
    console.log(`Extracted ${textData.length} text spans from PDF. Preview: ${fullText.substring(0, 50)}...`);
    return textData;
  };

  // Compare two versions and generate diff
  const compareVersions = async (v1: number, v2: number) => {
    if (typeof window === 'undefined' || !isMounted) return;
    if (!versions.length || v1 === v2 || !pageContainerRef.current) return;
    
    const version1 = versions.find(v => v.version === v1);
    const version2 = versions.find(v => v.version === v2);
    
    if (!version1 || !version2) {
      console.warn('Versions not found:', v1, v2);
      return;
    }
    
    try {
      // Store original state
      const originalUrl = fileUrl;
      const originalVersion = currentVersion;
      
      // Get the actual PDF bytes from the stored versions
      // Make sure we're using the ArrayBuffer directly
      console.log('Comparing V' + v1 + ' vs V' + v2);
      console.log('V1 PDF data size:', version1.pdfData.byteLength);
      console.log('V2 PDF data size:', version2.pdfData.byteLength);
      
      // Convert PDF data to base64 data URLs to avoid blob URL issues with PDF.js
      const toBase64 = (buffer: ArrayBuffer): string => {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        const chunkSize = 8192;
        for (let i = 0; i < bytes.length; i += chunkSize) {
          const chunk = bytes.subarray(i, i + chunkSize);
          binary += String.fromCharCode.apply(null, Array.from(chunk));
        }
        return btoa(binary);
      };
      
      // Ensure we're using a fresh copy of the ArrayBuffer
      const v1Buffer = version1.pdfData.slice(0);
      const v2Buffer = version2.pdfData.slice(0);
      
      const dataUrl1 = `data:application/pdf;base64,${toBase64(v1Buffer)}`;
      const dataUrl2 = `data:application/pdf;base64,${toBase64(v2Buffer)}`;
      
      console.log('V1 data URL length:', dataUrl1.length);
      console.log('V2 data URL length:', dataUrl2.length);
      
      // Load version 1 and extract text
      if (fileUrl && fileUrl.startsWith('blob:')) {
        URL.revokeObjectURL(fileUrl);
      }
      
      console.log('Loading V1 for comparison...');
      console.log('V1 data URL preview:', dataUrl1.substring(0, 100) + '...');
      
      // Force a complete reload by clearing first, then setting
      setFileUrl(null);
      await new Promise(resolve => setTimeout(resolve, 200));
      setFileUrl(dataUrl1);
      setCurrentVersion(v1);
      
      // Wait for React to update and PDF to render
      await new Promise(resolve => setTimeout(resolve, 500)); // Let React update
      
      // Wait for PDF to render - need to wait for react-pdf to fully render
      // Also verify the PDF has actually loaded by checking the Document component
      let pdfLoaded = false;
      let loadAttempts = 0;
      while (!pdfLoaded && loadAttempts < 20) {
        const docElement = pageContainerRef.current?.querySelector('.react-pdf__Document');
        const pageElement = pageContainerRef.current?.querySelector('.react-pdf__Page');
        if (docElement && pageElement) {
          // Check if PDF is actually loaded (not just the container)
          const canvas = pageElement.querySelector('canvas');
          if (canvas && canvas.width > 0) {
            pdfLoaded = true;
            break;
          }
        }
        await new Promise(resolve => setTimeout(resolve, 200));
        loadAttempts++;
      }
      
      if (!pdfLoaded) {
        console.warn('PDF V1 did not load properly');
      }
      
      // Additional wait for text layer
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Retry extraction if it fails
      let text1 = await extractTextFromCurrentPdf(dataUrl1);
      let retries = 0;
      while (text1.length === 0 && retries < 3) {
        console.log(`Retrying V1 text extraction (attempt ${retries + 1})...`);
        await new Promise(resolve => setTimeout(resolve, 1500));
        text1 = await extractTextFromCurrentPdf(dataUrl1);
        retries++;
      }
      
      console.log('Extracted text from V1:', text1.length, 'spans');
      const v1FullText = text1.map(t => t.text).join(' ');
      console.log('V1 text preview:', v1FullText.substring(0, 100));
      console.log('V1 full text length:', v1FullText.length);
      
      // Load version 2 and extract text
      console.log('Loading V2 for comparison...');
      console.log('V2 data URL preview:', dataUrl2.substring(0, 100) + '...');
      
      // Force a complete reload by clearing first, then setting
      setFileUrl(null);
      await new Promise(resolve => setTimeout(resolve, 200));
      setFileUrl(dataUrl2);
      setCurrentVersion(v2);
      
      // Wait for React to update and PDF to render
      await new Promise(resolve => setTimeout(resolve, 500)); // Let React update
      
      // Wait for PDF to render - verify it's actually loaded
      pdfLoaded = false;
      loadAttempts = 0;
      while (!pdfLoaded && loadAttempts < 20) {
        const docElement = pageContainerRef.current?.querySelector('.react-pdf__Document');
        const pageElement = pageContainerRef.current?.querySelector('.react-pdf__Page');
        if (docElement && pageElement) {
          const canvas = pageElement.querySelector('canvas');
          if (canvas && canvas.width > 0) {
            pdfLoaded = true;
            break;
          }
        }
        await new Promise(resolve => setTimeout(resolve, 200));
        loadAttempts++;
      }
      
      if (!pdfLoaded) {
        console.warn('PDF V2 did not load properly');
      }
      
      // Additional wait for text layer
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Retry extraction if it fails
      let text2 = await extractTextFromCurrentPdf(dataUrl2);
      retries = 0;
      while (text2.length === 0 && retries < 3) {
        console.log(`Retrying V2 text extraction (attempt ${retries + 1})...`);
        await new Promise(resolve => setTimeout(resolve, 1500));
        text2 = await extractTextFromCurrentPdf(dataUrl2);
        retries++;
      }
      
      console.log('Extracted text from V2:', text2.length, 'spans');
      const v2FullText = text2.map(t => t.text).join(' ');
      console.log('V2 text preview:', v2FullText.substring(0, 100));
      console.log('V2 full text length:', v2FullText.length);
      
      // Verify texts are different
      if (v1FullText === v2FullText) {
        console.warn('WARNING: V1 and V2 texts are identical! The PDFs might not have been saved correctly.');
      } else {
        console.log('✓ Texts are different - comparison should work');
      }
      
      if (text1.length === 0 && text2.length === 0) {
        alert('Could not extract text from PDFs. Make sure the PDFs contain text.');
        setDiffMode(false);
        setDiffVersions({ v1: null, v2: null });
        setTextDiffs([]);
        setDiffsReady(false);
        return;
      }
      
      // If one version has no text, still compare (one might be empty)
      if (text1.length === 0) {
        console.warn('V1 has no text, comparing empty vs V2');
      }
      if (text2.length === 0) {
        console.warn('V2 has no text, comparing V1 vs empty');
      }
      
      // Compare texts using diff-match-patch
      let dmp;
      try {
        // diff-match-patch can be imported in different ways depending on the build
        const dmpModule = await import('diff-match-patch');
        
        // Try different ways to get the constructor
        const dmpAny = dmpModule as any;
        
        if (typeof dmpAny === 'function') {
          dmp = new dmpAny();
        } else if (dmpAny.default && typeof dmpAny.default === 'function') {
          dmp = new dmpAny.default();
        } else if (dmpAny.diff_match_patch) {
          const DMPClass = dmpAny.diff_match_patch;
          if (typeof DMPClass === 'function') {
            dmp = new DMPClass();
          } else if (DMPClass.diff_match_patch && typeof DMPClass.diff_match_patch === 'function') {
            dmp = new DMPClass.diff_match_patch();
          } else {
            dmp = DMPClass;
          }
        } else {
          // Fallback: use the module itself if it has the methods
          dmp = dmpAny;
        }
        
        // Verify dmp has the required methods
        if (!dmp || typeof dmp.diff_main !== 'function') {
          throw new Error('diff-match-patch not properly initialized');
        }
      } catch (error) {
        console.error('Failed to load diff-match-patch:', error);
        throw new Error('Failed to load diff library');
      }
      
      const text1Str = text1.map((t: { text: string }) => t.text).join(' ');
      const text2Str = text2.map((t: { text: string }) => t.text).join(' ');
      
      console.log('Text1 length:', text1Str.length, 'Text2 length:', text2Str.length);
      console.log('Text1 preview:', text1Str.substring(0, 100));
      console.log('Text2 preview:', text2Str.substring(0, 100));
      
      const diffs = dmp.diff_main(text1Str, text2Str);
      dmp.diff_cleanupSemantic(diffs);
      
      console.log('Diff operations:', diffs.length);
      console.log('Diffs:', diffs.slice(0, 10)); // Log first 10 diffs
      
      // Map diffs back to coordinates - use version 2 (current) for positioning
      const diffHighlights: Array<{
        type: 'added' | 'deleted' | 'modified';
        text: string;
        x: number;
        y: number;
        width: number;
        height: number;
        page?: number;
        isAnnotation?: boolean;
      }> = [];
      
      // Build a map from character positions in joined string to spans
      // Also track which spans cover which character ranges
      const buildSpanRanges = (spans: typeof text1) => {
        const ranges: Array<{
          span: typeof text1[0];
          startChar: number;
          endChar: number;
        }> = [];
        let charPos = 0;
        spans.forEach(span => {
          const startChar = charPos;
          const endChar = charPos + span.text.length;
          ranges.push({ span, startChar, endChar });
          charPos = endChar + 1; // +1 for space when joining
        });
        return ranges;
      };
      
      const ranges1 = buildSpanRanges(text1);
      const ranges2 = buildSpanRanges(text2);
      
      let text1CharIndex = 0;
      let text2CharIndex = 0;
      
      console.log('Processing', diffs.length, 'diff operations...');
      console.log('V1 has', ranges1.length, 'span ranges, V2 has', ranges2.length, 'span ranges');
      
      // Helper function to find spans covering a character range
      const findSpansInRange = (ranges: typeof ranges1, startChar: number, endChar: number) => {
        return ranges.filter(r => 
          (startChar >= r.startChar && startChar < r.endChar) ||
          (endChar > r.startChar && endChar <= r.endChar) ||
          (startChar <= r.startChar && endChar >= r.endChar)
        );
      };
      
      // Helper function to calculate bounding box from multiple spans
      const calculateBoundingBox = (spans: Array<typeof text1[0]>) => {
        if (spans.length === 0) return null;
        if (spans.length === 1) {
          return {
            x: spans[0].x,
            y: spans[0].y,
            width: spans[0].width,
            height: spans[0].height,
          };
        }
        
        // Find min/max coordinates
        const xs = spans.map(s => s.x);
        const ys = spans.map(s => s.y);
        const widths = spans.map(s => s.x + s.width);
        const heights = spans.map(s => s.y + s.height);
        
        const minX = Math.min(...xs);
        const minY = Math.min(...ys);
        const maxX = Math.max(...widths);
        const maxY = Math.max(...heights);
        
        return {
          x: minX,
          y: minY,
          width: maxX - minX,
          height: maxY - minY,
        };
      };
      
      // Helper to find spans by text content (more reliable than character positions)
      const findSpansByText = (spans: typeof text1, searchText: string, startCharIndex: number, ranges: typeof ranges1) => {
        const normalizedSearch = searchText.trim().toLowerCase();
        if (!normalizedSearch) return [];
        
        // First try to find spans at the character position
        const rangeSpans = findSpansInRange(ranges, startCharIndex, startCharIndex + searchText.length);
        
        if (rangeSpans.length > 0) {
          return rangeSpans.map(r => r.span);
        }
        
        // If not found, search by text content - look for spans that contain the diff text
        const matchingSpans: typeof text1 = [];
        
        // Build the full text from spans to find where the diff text appears
        const fullText = spans.map(s => s.text).join(' ').toLowerCase();
        const searchIndex = fullText.indexOf(normalizedSearch);
        
        if (searchIndex >= 0) {
          // Find which spans contain this text
          let charCount = 0;
          for (const span of spans) {
            const spanStart = charCount;
            const spanEnd = charCount + span.text.length;
            
            if (searchIndex >= spanStart && searchIndex < spanEnd) {
              matchingSpans.push(span);
            } else if (searchIndex < spanStart && searchIndex + normalizedSearch.length > spanStart) {
              // Text spans across multiple spans
              matchingSpans.push(span);
            }
            
            charCount = spanEnd + 1; // +1 for space
            
            if (charCount > searchIndex + normalizedSearch.length) {
              break; // We've covered the search text
            }
          }
        }
        
        return matchingSpans;
      };
      
      diffs.forEach((diff: [number, string], diffIndex: number) => {
        const [operation, text] = diff;
        const trimmedText = text.trim();
        
        console.log(`Diff ${diffIndex}: operation=${operation}, text="${text.substring(0, 50)}", text1CharIndex=${text1CharIndex}, text2CharIndex=${text2CharIndex}`);
        
        if (operation === -1) {
          // Deleted text - use version 1 coordinates
          const endChar = text1CharIndex + text.length;
          let coveringSpans = findSpansInRange(ranges1, text1CharIndex, endChar);
          
          // If not found by range, try searching by text content
          if (coveringSpans.length === 0 && trimmedText) {
            const textSpans = findSpansByText(text1, trimmedText, text1CharIndex, ranges1);
            coveringSpans = textSpans.map(span => {
              const range = ranges1.find(r => r.span === span);
              return range || { span, startChar: text1CharIndex, endChar: text1CharIndex + span.text.length };
            });
          }
          
          if (coveringSpans.length > 0) {
            const spans = coveringSpans.map(r => r.span);
            const bbox = calculateBoundingBox(spans);
            if (bbox) {
              console.log(`  → Adding deleted highlight for "${trimmedText}" covering ${coveringSpans.length} spans`, bbox);
              diffHighlights.push({
                type: 'deleted',
                text: trimmedText || text,
                x: bbox.x,
                y: bbox.y,
                width: bbox.width,
                height: bbox.height,
              });
            }
          } else {
            console.warn(`  → Could not find spans for deleted text "${trimmedText}" at range [${text1CharIndex}, ${endChar}]`);
            // Fallback: try to find by text content more aggressively
            if (trimmedText) {
              const fallbackSpans = findSpansByText(text1, trimmedText, text1CharIndex, ranges1);
              if (fallbackSpans.length > 0) {
                const bbox = calculateBoundingBox(fallbackSpans);
                if (bbox) {
                  console.log(`  → Using fallback text search for deleted text "${trimmedText}"`, bbox);
                  diffHighlights.push({
                    type: 'deleted',
                    text: trimmedText || text,
                    x: bbox.x,
                    y: bbox.y,
                    width: bbox.width,
                    height: bbox.height,
                  });
                }
              } else {
                // Last resort: use the span at the start position
                const startRange = ranges1.find(r => text1CharIndex >= r.startChar && text1CharIndex < r.endChar) ||
                                  ranges1.find(r => r.startChar >= text1CharIndex);
                if (startRange) {
                  console.log(`  → Using last resort span for deleted text`, startRange.span);
                  diffHighlights.push({
                    type: 'deleted',
                    text: trimmedText || text,
                    x: startRange.span.x,
                    y: startRange.span.y,
                    width: startRange.span.width || 100,
                    height: startRange.span.height,
                  });
                } else {
                  console.error(`  → Could not find ANY span for deleted text "${trimmedText}"`);
                }
              }
            }
          }
          text1CharIndex += text.length;
        } else if (operation === 1) {
          // Added text - use version 2 coordinates
          const endChar = text2CharIndex + text.length;
          let coveringSpans = findSpansInRange(ranges2, text2CharIndex, endChar);
          
          // If not found by range, try searching by text content
          if (coveringSpans.length === 0 && trimmedText) {
            const textSpans = findSpansByText(text2, trimmedText, text2CharIndex, ranges2);
            coveringSpans = textSpans.map(span => {
              const range = ranges2.find(r => r.span === span);
              return range || { span, startChar: text2CharIndex, endChar: text2CharIndex + span.text.length };
            });
          }
          
          // For added text, also check if the diff text appears in V2's full text
          // This handles cases where text was added and appears in spans
          if (coveringSpans.length === 0 && trimmedText) {
            const v2FullText = text2.map(s => s.text).join(' ');
            const diffTextIndex = v2FullText.indexOf(trimmedText);
            if (diffTextIndex >= 0) {
              // Find spans that contain this text
              let charPos = 0;
              for (let i = 0; i < text2.length; i++) {
                const span = text2[i];
                const spanStart = charPos;
                const spanEnd = charPos + span.text.length;
                
                if (diffTextIndex >= spanStart && diffTextIndex < spanEnd) {
                  // This span contains the start of the diff text
                  const matchingSpans = [span];
                  // Check if we need more spans
                  let remainingLength = trimmedText.length - (spanEnd - diffTextIndex);
                  for (let j = i + 1; j < text2.length && remainingLength > 0; j++) {
                    matchingSpans.push(text2[j]);
                    remainingLength -= text2[j].text.length + 1; // +1 for space
                  }
                  
                  coveringSpans = matchingSpans.map(span => {
                    const range = ranges2.find(r => r.span === span);
                    return range || { span, startChar: spanStart, endChar: spanEnd };
                  });
                  break;
                }
                charPos = spanEnd + 1; // +1 for space
              }
            }
          }
          
          // Also try finding spans that come after the current position (for newly added text)
          if (coveringSpans.length === 0) {
            // Find the span range that contains or is just after text2CharIndex
            const afterRange = ranges2.find(r => r.startChar >= text2CharIndex);
            if (afterRange) {
              coveringSpans = [afterRange];
            }
          }
          
          if (coveringSpans.length > 0) {
            const spans = coveringSpans.map(r => r.span);
            const bbox = calculateBoundingBox(spans);
            if (bbox) {
              console.log(`  → Adding added highlight for "${trimmedText}" covering ${coveringSpans.length} spans`, bbox);
              console.log(`  → Spans:`, spans.map(s => ({ text: s.text.substring(0, 20), x: s.x, y: s.y })));
              diffHighlights.push({
                type: 'added',
                text: trimmedText || text,
                x: bbox.x,
                y: bbox.y,
                width: bbox.width,
                height: bbox.height,
              });
            }
          } else {
            console.warn(`  → Could not find spans for added text "${trimmedText}" at range [${text2CharIndex}, ${endChar}]`);
            // Fallback: use the span at or after the start position
            const startRange = ranges2.find(r => text2CharIndex >= r.startChar && text2CharIndex < r.endChar) ||
                              ranges2.find(r => r.startChar >= text2CharIndex);
            if (startRange) {
              console.log(`  → Using fallback span for added text`, startRange.span);
              diffHighlights.push({
                type: 'added',
                text: trimmedText || text,
                x: startRange.span.x,
                y: startRange.span.y,
                width: startRange.span.width || 100,
                height: startRange.span.height,
              });
            }
          }
          text2CharIndex += text.length;
        } else {
          // Unchanged text (operation === 0)
          text1CharIndex += text.length;
          text2CharIndex += text.length;
        }
      });
      
      console.log('Created', diffHighlights.length, 'highlights from', diffs.length, 'diff operations');
      
      // Compare annotations between versions
      const annotations1 = version1.annotations || [];
      const annotations2 = version2.annotations || [];
      
      // Create maps for easier comparison (by id or by position+type)
      const createAnnotationKey = (ann: typeof annotations1[0]) => {
        // Use a combination of type, page, and approximate position as key
        // Round coordinates to avoid floating point issues
        const roundedX = Math.round(ann.x / 10) * 10;
        const roundedY = Math.round(ann.y / 10) * 10;
        return `${ann.type}-${ann.page}-${roundedX}-${roundedY}`;
      };
      
      const annMap1 = new Map(annotations1.map(ann => [createAnnotationKey(ann), ann]));
      const annMap2 = new Map(annotations2.map(ann => [createAnnotationKey(ann), ann]));
      
      // Find added annotations (in v2 but not in v1)
      annotations2.forEach(ann => {
        const key = createAnnotationKey(ann);
        if (!annMap1.has(key)) {
          console.log(`Added annotation: ${ann.type} on page ${ann.page}`);
          diffHighlights.push({
            type: 'added',
            text: ann.text || `${ann.type} annotation`,
            x: ann.x,
            y: ann.y,
            width: ann.width,
            height: ann.height,
            page: ann.page,
            isAnnotation: true,
          });
        } else {
          // Check if modified (different text or properties)
          const ann1 = annMap1.get(key)!;
          if (ann.text !== ann1.text || ann.width !== ann1.width || ann.height !== ann1.height) {
            console.log(`Modified annotation: ${ann.type} on page ${ann.page}`);
            diffHighlights.push({
              type: 'modified',
              text: ann.text || `${ann.type} annotation`,
              x: ann.x,
              y: ann.y,
              width: ann.width,
              height: ann.height,
              page: ann.page,
              isAnnotation: true,
            });
          }
        }
      });
      
      // Find deleted annotations (in v1 but not in v2)
      annotations1.forEach(ann => {
        const key = createAnnotationKey(ann);
        if (!annMap2.has(key)) {
          console.log(`Deleted annotation: ${ann.type} on page ${ann.page}`);
          diffHighlights.push({
            type: 'deleted',
            text: ann.text || `${ann.type} annotation`,
            x: ann.x,
            y: ann.y,
            width: ann.width,
            height: ann.height,
            page: ann.page,
            isAnnotation: true,
          });
        }
      });
      
      console.log('Found', diffHighlights.length, 'differences (text + annotations)');
      
      // Ensure version 2 is fully loaded and rendered before setting diffs
      // Wait a bit more to ensure the PDF is fully rendered
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Verify the PDF is still loaded
      const finalPageElement = pageContainerRef.current?.querySelector('.react-pdf__Page');
      const finalCanvas = finalPageElement?.querySelector('canvas');
      if (!finalCanvas || finalCanvas.width === 0) {
        console.warn('PDF not fully rendered when setting diffs, waiting more...');
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      // Keep version 2 loaded (newer version)
      // Set diffs and mode together - show immediately
      setDiffVersions({ v1, v2 });
      setDiffMode(true);
      setTextDiffs(diffHighlights);
      setDiffsReady(true); // Mark as ready immediately - rendering will handle positioning
      
      console.log('Diffs set, ready to display:', diffHighlights.length, 'highlights');
      
      // Don't restore original - show version 2 with diffs
      
    } catch (error) {
      console.error('Error comparing versions:', error);
      alert('Failed to compare versions. Please try again.');
      setDiffMode(false);
      setDiffVersions({ v1: null, v2: null });
      setTextDiffs([]);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      setFile(selectedFile);
      // Create object URL for the file
      const url = URL.createObjectURL(selectedFile);
      setFileUrl(url);
      setPosition({ x: 0, y: 0 });
      setScale(1.0);
      setNumPages(0);
      setPageNumber(1);
      setIsEditMode(false);
      // Load PDF with pdf-lib
      await loadPdfWithLib(selectedFile);
    }
  };

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const droppedFile = e.dataTransfer.files[0];
      if (droppedFile.type === 'application/pdf') {
        setFile(droppedFile);
        // Create object URL for the file
        const url = URL.createObjectURL(droppedFile);
        setFileUrl(url);
        setPosition({ x: 0, y: 0 });
        setScale(1.0);
        setNumPages(0);
        setPageNumber(1);
        setIsEditMode(false);
        // Load PDF with pdf-lib
        await loadPdfWithLib(droppedFile);
      }
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 0) {
      setIsDragging(true);
      setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging) {
      setPosition({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y,
      });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      setScale((prev) => Math.max(0.5, Math.min(3.0, prev + delta)));
    }
  };

  const goToPage = (page: number) => {
    setPageNumber(page);
  };

  const zoomIn = () => setScale((prev) => Math.min(3.0, prev + 0.2));
  const zoomOut = () => setScale((prev) => Math.max(0.5, prev - 0.2));
  const resetZoom = () => {
    setScale(1.0);
    setPosition({ x: 0, y: 0 });
  };

  // Clean up object URL when component unmounts or file changes
  useEffect(() => {
    return () => {
      if (fileUrl) {
        URL.revokeObjectURL(fileUrl);
      }
    };
  }, [fileUrl]);

  const handleNewPdf = () => {
    if (fileUrl) {
      URL.revokeObjectURL(fileUrl);
    }
    setFile(null);
    setFileUrl(null);
    setNumPages(0);
    setPageNumber(1);
    setIsEditMode(false);
    setEditingElement(null);
    setPdfDoc(null);
    setEditingText('');
    setEditingPosition(null);
    setEditingStyles(null);
  };

  // Handle text editing with pdf-lib
  const handleTextClick = useCallback(async (e: MouseEvent) => {
    if (!isEditMode || !pdfDoc) return;
    
    const target = e.target as HTMLElement;
    const span = target.closest('span');
    if (!span) return;
    
    e.preventDefault();
    e.stopPropagation();
    
    const computedStyle = window.getComputedStyle(span);
    const rect = span.getBoundingClientRect();
    const containerRect = pageContainerRef.current?.getBoundingClientRect();
    const pageElement = pageContainerRef.current?.querySelector('.react-pdf__Page');
    const pageRect = pageElement?.getBoundingClientRect();
    
    if (!containerRect || !pageRect) return;
    
    // Get the actual text content - try multiple methods
    let textContent = span.textContent || '';
    if (!textContent) {
      textContent = (span as HTMLElement).innerText || '';
    }
    if (!textContent) {
      textContent = span.textContent || '';
    }
    
    // Extract color - sample from the canvas since PDF.js renders color there
    // Don't use computedStyle.color as initial value - it's often wrong (defaults to blue/black)
    let textColor: string | null = null;
    
    // Try to get color from canvas by sampling the pixel at the text position
    const canvas = pageElement?.querySelector('canvas');
    if (canvas) {
      try {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          // Get canvas dimensions (actual vs displayed)
          const canvasRect = canvas.getBoundingClientRect();
          const canvasWidth = canvas.width;
          const canvasHeight = canvas.height;
          const displayedWidth = canvasRect.width;
          const displayedHeight = canvasRect.height;
          
          // Calculate scale factors
          const scaleX = canvasWidth / displayedWidth;
          const scaleY = canvasHeight / displayedHeight;
          
          // Get span position relative to canvas
          const spanX = rect.left - canvasRect.left;
          const spanY = rect.top - canvasRect.top;
          
          // Convert to canvas coordinates (accounting for scaling)
          const canvasX = Math.floor(spanX * scaleX);
          const canvasY = Math.floor(spanY * scaleY);
          const canvasWidth_scaled = Math.floor(rect.width * scaleX);
          const canvasHeight_scaled = Math.floor(rect.height * scaleY);
          
          // Sample a grid of pixels across the text area to get accurate color
          // Sample more pixels in the center area (where text is most solid)
          const sampleWidth = Math.max(1, Math.floor(canvasWidth_scaled * 0.8));
          const sampleHeight = Math.max(1, Math.floor(canvasHeight_scaled * 0.6));
          const startX = canvasX + Math.floor(canvasWidth_scaled * 0.1);
          const startY = canvasY + Math.floor(canvasHeight_scaled * 0.2);
          
          // Ensure we're within bounds
          const safeStartX = Math.max(0, Math.min(startX, canvasWidth - 1));
          const safeStartY = Math.max(0, Math.min(startY, canvasHeight - 1));
          const safeWidth = Math.min(sampleWidth, canvasWidth - safeStartX);
          const safeHeight = Math.min(sampleHeight, canvasHeight - safeStartY);
          
          if (safeWidth > 0 && safeHeight > 0) {
            const imageData = ctx.getImageData(safeStartX, safeStartY, safeWidth, safeHeight);
            const data = imageData.data;
            
            // Collect all non-transparent pixels with their colors
            const pixels: Array<{ r: number; g: number; b: number; brightness: number }> = [];
            
            for (let i = 0; i < data.length; i += 4) {
              const alpha = data[i + 3];
              // Only use pixels with sufficient opacity (text pixels)
              if (alpha > 100) {
                const r = data[i];
                const g = data[i + 1];
                const b = data[i + 2];
                // Calculate brightness to prioritize darker pixels (actual text)
                const brightness = (r + g + b) / 3;
                pixels.push({ r, g, b, brightness });
              }
            }
            
            if (pixels.length > 0) {
              // Sort by brightness (darkest first) and take the darkest 30% of pixels
              // This filters out anti-aliasing edges which are lighter
              pixels.sort((a, b) => a.brightness - b.brightness);
              const darkestCount = Math.max(1, Math.floor(pixels.length * 0.3));
              const darkestPixels = pixels.slice(0, darkestCount);
              
              // Calculate average of darkest pixels
              let r = 0, g = 0, b = 0;
              for (const pixel of darkestPixels) {
                r += pixel.r;
                g += pixel.g;
                b += pixel.b;
              }
              
              r = Math.floor(r / darkestPixels.length);
              g = Math.floor(g / darkestPixels.length);
              b = Math.floor(b / darkestPixels.length);
              
              textColor = `rgb(${r}, ${g}, ${b})`;
              console.log('Canvas color sampled:', {
                spanRect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
                canvasRect: { left: canvasRect.left, top: canvasRect.top, width: displayedWidth, height: displayedHeight },
                canvasCoords: { x: canvasX, y: canvasY, width: canvasWidth_scaled, height: canvasHeight_scaled },
                sampleArea: { x: safeStartX, y: safeStartY, width: safeWidth, height: safeHeight },
                scale: { x: scaleX, y: scaleY },
                totalPixels: pixels.length,
                darkestPixelsUsed: darkestPixels.length,
                sampledColor: textColor,
                brightnessRange: pixels.length > 0 ? {
                  min: pixels[0].brightness,
                  max: pixels[pixels.length - 1].brightness,
                  avg: pixels.reduce((sum, p) => sum + p.brightness, 0) / pixels.length
                } : null
              });
            } else {
              console.warn('No valid pixels sampled from canvas');
            }
          } else {
            console.warn('Sample area is out of bounds');
          }
        }
      } catch (e) {
        console.warn('Could not sample color from canvas:', e);
      }
    }
    
    // Fallback: Check for inline style color (only if canvas sampling failed)
    if (!textColor || textColor === 'rgb(255, 255, 255)' || textColor === 'white') {
      const inlineColor = (span as HTMLElement).style?.color;
      if (inlineColor && inlineColor !== '' && inlineColor !== 'white' && inlineColor !== 'rgb(0, 0, 0)') {
        textColor = inlineColor;
        console.log('Using inline color:', inlineColor);
      }
    }
    
    // Fallback: Check for fill attribute (SVG elements)
    if (!textColor || textColor === 'rgb(255, 255, 255)' || textColor === 'white') {
      const fillAttr = span.getAttribute('fill');
      if (fillAttr && fillAttr !== 'none' && fillAttr !== 'transparent' && fillAttr !== 'white') {
        textColor = fillAttr;
        console.log('Using fill attribute:', fillAttr);
      }
    }
    
    // Fallback: Check computed fill (for SVG text)
    if (!textColor || textColor === 'rgb(255, 255, 255)' || textColor === 'white') {
      const computedFill = computedStyle.fill;
      if (computedFill && computedFill !== 'none' && computedFill !== 'transparent' && computedFill !== 'rgb(255, 255, 255)' && computedFill !== 'white') {
        textColor = computedFill;
        console.log('Using computed fill:', computedFill);
      }
    }
    
    // Last resort: Use computedStyle.color but log a warning (avoid default blue)
    if (!textColor || textColor === 'rgb(255, 255, 255)' || textColor === 'white') {
      const computedColor = computedStyle.color;
      // Only use if it's not a default/system color (blue is rgb(0, 0, 238) in some browsers)
      if (computedColor && computedColor !== 'rgb(0, 0, 0)' && computedColor !== 'rgb(0, 0, 238)' && computedColor !== 'rgb(0, 0, 255)') {
        textColor = computedColor;
        console.warn('Using computedStyle.color as last resort:', computedColor);
      }
    }
    
    // Convert named colors and rgb() to hex if needed
    if (textColor && !textColor.startsWith('#')) {
      // Try to convert rgb/rgba to hex
      const rgbMatch = textColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*[\d.]+)?\)/);
      if (rgbMatch) {
        const r = parseInt(rgbMatch[1]).toString(16).padStart(2, '0');
        const g = parseInt(rgbMatch[2]).toString(16).padStart(2, '0');
        const b = parseInt(rgbMatch[3]).toString(16).padStart(2, '0');
        textColor = `#${r}${g}${b}`;
      }
    }
    
    // If color is white or transparent, use black as fallback
    if (!textColor || textColor === 'rgba(0, 0, 0, 0)' || textColor === 'transparent' || textColor === 'none' || textColor === 'rgb(255, 255, 255)' || textColor === 'white') {
      textColor = '#000000';
    }
    
    // Check if color is very light (for white/light backgrounds) - only if it's rgb format
    if (textColor.startsWith('rgb')) {
      const rgbMatch = textColor.match(/\d+/g);
      if (rgbMatch && rgbMatch.length >= 3) {
        const r = parseInt(rgbMatch[0]);
        const g = parseInt(rgbMatch[1]);
        const b = parseInt(rgbMatch[2]);
        // If color is very light (close to white), use black for visibility
        if (r > 240 && g > 240 && b > 240) {
          textColor = '#000000';
        }
      }
    }
    
    // Calculate position relative to the PDF page element
    // Account for the page's position within the container
    const pageX = rect.left - pageRect.left;
    const pageY = rect.top - pageRect.top;
    
    // Store span info for coordinate conversion
    const spanInfo = {
      span: span as HTMLElement,
      textContent: textContent,
      screenX: pageX,
      screenY: pageY,
      width: rect.width,
      height: rect.height,
      fontSize: parseFloat(computedStyle.fontSize),
      transform: computedStyle.transform,
    };
    
    setEditingElement(span as HTMLElement);
    setEditingText(textContent);
    setEditingPosition({
      x: pageX,
      y: pageY,
      width: rect.width,
      height: rect.height,
    });
    
    // Create a modified style object with ensured visibility
    const modifiedStyle = { ...computedStyle } as any;
    modifiedStyle.color = textColor;
    
    // Debug: log the color extraction
    console.log('Text color extracted:', {
      computedColor: computedStyle.color,
      inlineColor: (span as HTMLElement).style?.color,
      fillAttr: span.getAttribute('fill'),
      computedFill: computedStyle.fill,
      finalColor: textColor,
    });
    
    setEditingStyles(modifiedStyle);
    
    // Store span info for later use
    (span as any)._editInfo = spanInfo;
  }, [isEditMode, pdfDoc]);

  // Auto-trigger comparison when both versions are selected in diff mode
  useEffect(() => {
    // Only run on client side and when mounted
    if (typeof window === 'undefined' || !isMounted) return;
    
    // Trigger comparison when both versions are selected and we don't have diffs yet
    if (diffMode && diffVersions.v1 && diffVersions.v2 && diffVersions.v1 !== diffVersions.v2 && textDiffs.length === 0) {
      console.log('Auto-triggering comparison:', diffVersions.v1, 'vs', diffVersions.v2);
      compareVersions(diffVersions.v1, diffVersions.v2).catch((error) => {
        console.error('Error in auto-triggered comparison:', error);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diffMode, diffVersions.v1, diffVersions.v2, isMounted]);
  
  // Force re-render of diff overlay when PDF loads (fileUrl changes)
  // This ensures diffs appear even if PDF wasn't ready when they were first set
  useEffect(() => {
    if (diffMode && textDiffs.length > 0 && fileUrl) {
      // Small delay to ensure PDF has rendered
      const timer = setTimeout(() => {
        // Force a state update to trigger re-render of diff overlay
        // This is a no-op but triggers React to re-check the rendering conditions
        setDiffsReady(prev => !prev);
        setTimeout(() => setDiffsReady(prev => !prev), 0);
      }, 500);
      
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileUrl, diffMode]);

  // Helper function to hide spans that overlap with edited regions
  const hideEditedSpans = useCallback(() => {
    if (!pageContainerRef.current || editedRegions.length === 0) {
      return;
    }
    
    const textLayer = pageContainerRef.current?.querySelector('.react-pdf__Page__textContent');
    if (!textLayer) {
      console.log('Text layer not found');
      return;
    }
    
    const textSpans = textLayer.querySelectorAll('span');
    const currentPageRegions = editedRegions.filter(r => r.page === pageNumber);
    
    if (currentPageRegions.length === 0) {
      console.log(`No edited regions for page ${pageNumber}`);
      return;
    }
    
    console.log(`Checking ${textSpans.length} spans against ${currentPageRegions.length} edited regions on page ${pageNumber}`);
    console.log('Edited regions:', currentPageRegions);
    
    const pageElement = pageContainerRef.current?.querySelector('.react-pdf__Page');
    const pageRect = pageElement?.getBoundingClientRect();
    const containerRect = pageContainerRef.current.getBoundingClientRect();
    
    if (!pageRect || !containerRect) {
      console.log('Could not get page or container rect');
      return;
    }
    
    let hiddenCount = 0;
    textSpans.forEach((span, index) => {
      const htmlSpan = span as HTMLElement;
      
      // Skip if already marked as edited
      if ((htmlSpan as any)._edited) {
        htmlSpan.style.display = 'none';
        return;
      }
      
      const rect = htmlSpan.getBoundingClientRect();
      // Convert to page-relative coordinates (matching how we stored regions)
      // Regions are stored relative to the page container, so we need page-relative coords
      const spanX = rect.left - pageRect.left;
      const spanY = rect.top - pageRect.top;
      const spanWidth = rect.width;
      const spanHeight = rect.height;
      
      // Check if this span overlaps with any edited region
      const overlaps = currentPageRegions.some(region => {
        // More precise overlap detection - check if span center is within region
        const centerX = spanX + spanWidth / 2;
        const centerY = spanY + spanHeight / 2;
        
        // Check if span center is within region bounds
        const centerInRegion = 
          centerX >= region.x && centerX <= region.x + region.width &&
          centerY >= region.y && centerY <= region.y + region.height;
        
        // Also check for significant overlap (at least 50% of span)
        const overlapX = spanX < region.x + region.width && spanX + spanWidth > region.x;
        const overlapY = spanY < region.y + region.height && spanY + spanHeight > region.y;
        const overlapArea = Math.max(0, Math.min(spanX + spanWidth, region.x + region.width) - Math.max(spanX, region.x)) *
                           Math.max(0, Math.min(spanY + spanHeight, region.y + region.height) - Math.max(spanY, region.y));
        const spanArea = spanWidth * spanHeight;
        const overlapRatio = spanArea > 0 ? overlapArea / spanArea : 0;
        
        return centerInRegion || (overlapX && overlapY && overlapRatio > 0.5);
      });
      
      if (overlaps) {
        console.log(`Hiding span ${index}: "${span.textContent?.substring(0, 20)}" at (${spanX.toFixed(1)}, ${spanY.toFixed(1)})`);
        htmlSpan.style.display = 'none';
        (htmlSpan as any)._edited = true;
        hiddenCount++;
      }
    });
    
    console.log(`Hidden ${hiddenCount} out of ${textSpans.length} spans that overlap with edited regions`);
  }, [editedRegions, pageNumber]);

  // Setup click handlers for text editing
  useEffect(() => {
    if (!isEditMode || !pageContainerRef.current) return;

    const setupHandlers = () => {
      const textLayer = pageContainerRef.current?.querySelector('.react-pdf__Page__textContent');
      if (!textLayer) return;

      // Clean up any existing handlers first
      const existingSpans = textLayer.querySelectorAll('span');
      existingSpans.forEach((span) => {
        const htmlSpan = span as HTMLElement;
        if ((htmlSpan as any)._cleanup) {
          (htmlSpan as any)._cleanup();
        }
      });

      // Hide spans that overlap with edited regions
      hideEditedSpans();
      
      // Add hover effect to text spans
      const textSpans = textLayer.querySelectorAll('span');
      textSpans.forEach((span) => {
        const htmlSpan = span as HTMLElement;
        
        // Skip spans that have been edited (they're hidden)
        if ((htmlSpan as any)._edited) {
          return;
        }
        
        htmlSpan.style.cursor = 'text';
        
        const handleMouseEnter = () => {
          if (editingElement !== htmlSpan) {
            htmlSpan.style.backgroundColor = 'rgba(59, 130, 246, 0.1)';
            htmlSpan.style.borderRadius = '2px';
          }
        };
        
        const handleMouseLeave = () => {
          if (editingElement !== htmlSpan) {
            htmlSpan.style.backgroundColor = 'transparent';
          }
        };
        
        const handleClick = (e: MouseEvent) => {
          handleTextClick(e);
        };
        
        htmlSpan.addEventListener('mouseenter', handleMouseEnter);
        htmlSpan.addEventListener('mouseleave', handleMouseLeave);
        htmlSpan.addEventListener('click', handleClick);
        
        (htmlSpan as any)._cleanup = () => {
          htmlSpan.removeEventListener('mouseenter', handleMouseEnter);
          htmlSpan.removeEventListener('mouseleave', handleMouseLeave);
          htmlSpan.removeEventListener('click', handleClick);
        };
      });
    };

    // Wait for text layer to render, then setup handlers
    const timeout = setTimeout(setupHandlers, 300);
    
    // Also try after a longer delay in case PDF is still loading
    const timeout2 = setTimeout(setupHandlers, 600);

    return () => {
      clearTimeout(timeout);
      clearTimeout(timeout2);
      const textLayer = pageContainerRef.current?.querySelector('.react-pdf__Page__textContent');
      if (textLayer) {
        const textSpans = textLayer.querySelectorAll('span');
        textSpans.forEach((span) => {
          const htmlSpan = span as HTMLElement;
          if ((htmlSpan as any)._cleanup) {
            (htmlSpan as any)._cleanup();
          }
          htmlSpan.style.cursor = '';
          htmlSpan.style.backgroundColor = 'transparent';
        });
      }
    };
  }, [isEditMode, pageNumber, handleTextClick, editingElement, fileUrl, hideEditedSpans, editedRegions]);

  // Save edited text to PDF using pdf-lib
  const saveTextEdit = useCallback(async () => {
    if (!pdfDoc || !editingElement || !editingPosition || !editingStyles || !editingText.trim()) return;
    
    setIsSaving(true);
    try {
      const page = pdfDoc.getPage(pageNumber - 1);
      const { width, height } = page.getSize();
      
      // Get the page element to calculate scale
      const pageElement = pageContainerRef.current?.querySelector('.react-pdf__Page');
      if (!pageElement) {
        throw new Error('Page element not found');
      }
      
      // Get the rendered page dimensions
      const pageStyle = window.getComputedStyle(pageElement);
      const renderedWidth = parseFloat(pageStyle.width);
      const renderedHeight = parseFloat(pageStyle.height);
      
      // Calculate the scale factor between rendered size and PDF size
      const scaleX = width / renderedWidth;
      const scaleY = height / renderedHeight;
      
      // Convert screen coordinates to PDF coordinates
      // PDF coordinates: (0,0) is bottom-left, Y increases upward
      // Screen coordinates: (0,0) is top-left, Y increases downward
      const pdfX = editingPosition.x * scaleX;
      const pdfY = height - (editingPosition.y * scaleY);
      
      // Get font size in PDF units
      const fontSize = (parseFloat(editingStyles.fontSize) * scaleX);
      
      // Embed a font
      const { StandardFonts, rgb } = await import('pdf-lib');
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      
      // Draw a white rectangle to cover the old text (with some padding)
      // This actually removes the old text from the PDF
      const padding = fontSize * 0.2;
      page.drawRectangle({
        x: pdfX - padding,
        y: pdfY - fontSize - padding,
        width: (editingPosition.width * scaleX) + (padding * 2),
        height: fontSize + (padding * 2),
        color: rgb(1, 1, 1),
        opacity: 1,
      });
      
      // Extract color from editingStyles and convert to RGB
      let textColorRgb = rgb(0, 0, 0); // Default to black
      console.log('Extracting color from editingStyles.color:', editingStyles.color);
      
      if (editingStyles.color) {
        try {
          // Parse color string (e.g., "rgb(255, 0, 0)" or "#ff0000")
          const colorStr = editingStyles.color.trim();
          console.log('Parsing color string:', colorStr);
          
          if (colorStr.startsWith('rgb')) {
            // Extract RGB values from "rgb(r, g, b)" or "rgba(r, g, b, a)"
            const match = colorStr.match(/\d+/g);
            if (match && match.length >= 3) {
              const r = parseInt(match[0]) / 255;
              const g = parseInt(match[1]) / 255;
              const b = parseInt(match[2]) / 255;
              textColorRgb = rgb(r, g, b);
              console.log('Parsed RGB color:', { r, g, b, original: colorStr });
            }
          } else if (colorStr.startsWith('#')) {
            // Hex color - handle both 3 and 6 digit hex
            const hex = colorStr.replace('#', '');
            let r, g, b;
            
            if (hex.length === 3) {
              // 3-digit hex (e.g., #000)
              r = parseInt(hex[0] + hex[0], 16) / 255;
              g = parseInt(hex[1] + hex[1], 16) / 255;
              b = parseInt(hex[2] + hex[2], 16) / 255;
            } else if (hex.length === 6) {
              // 6-digit hex (e.g., #000000)
              r = parseInt(hex.substring(0, 2), 16) / 255;
              g = parseInt(hex.substring(2, 4), 16) / 255;
              b = parseInt(hex.substring(4, 6), 16) / 255;
            } else {
              throw new Error('Invalid hex color format');
            }
            
            textColorRgb = rgb(r, g, b);
            console.log('Parsed hex color:', { r, g, b, original: colorStr });
          } else {
            // Try to parse named colors or other formats
            console.warn('Unknown color format, using black:', colorStr);
          }
        } catch (e) {
          console.warn('Could not parse color, using black:', e, 'Color string:', editingStyles.color);
        }
      } else {
        console.warn('No color in editingStyles, using black');
      }
      
      console.log('Final text color RGB:', textColorRgb);
      
      // Draw the new text with the extracted color
      page.drawText(editingText, {
        x: pdfX,
        y: pdfY - fontSize,
        size: fontSize,
        font: font,
        color: textColorRgb,
      });
      
      // Save PDF
      const pdfBytes = await pdfDoc.save();
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      
      // Reload the PDF document with the new bytes to allow multiple edits
      const { PDFDocument } = await import('pdf-lib');
      const updatedPdfDoc = await PDFDocument.load(await blob.arrayBuffer());
      setPdfDoc(updatedPdfDoc);
      
      // Force a small delay to ensure the PDF is reloaded
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Update file URL
      if (fileUrl) {
        URL.revokeObjectURL(fileUrl);
      }
      const newUrl = URL.createObjectURL(blob);
      setFileUrl(newUrl);
      
      // Update the original file
      const newFile = new File([blob], file?.name || 'edited.pdf', { type: 'application/pdf' });
      setFile(newFile);
      
      // Clear editing state
      setEditingElement(null);
      setEditingText('');
      setEditingPosition(null);
      setEditingStyles(null);
      
      // Store the edited region so we can hide overlapping spans after PDF reload
      // editingPosition is already relative to the page container, so use it directly
      if (editingPosition) {
        const newRegion = {
          x: editingPosition.x,
          y: editingPosition.y,
          width: editingPosition.width,
          height: editingPosition.height,
          page: pageNumber,
        };
        console.log('Storing edited region:', newRegion, 'for page', pageNumber);
        setEditedRegions(prev => [...prev, newRegion]);
      }
      
      // Hide the edited span in the text layer since it's been replaced with graphics
      // The text layer still shows the original text, but we've drawn over it
      if (editingElement && editingElement.parentElement) {
        // Mark this span as edited so we can hide it
        (editingElement as any)._edited = true;
        editingElement.style.display = 'none';
      }
      
      // Force re-render to re-attach click handlers after PDF update
      // The fileUrl change will trigger the useEffect to re-run
      // Also need to wait for PDF to fully reload
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Hide spans that overlap with edited regions
      hideEditedSpans();
      
    } catch (error) {
      console.error('Error saving text edit:', error);
      alert('Failed to save text edit. Please try again.');
      // Clear editing state even on error
      setEditingElement(null);
      setEditingText('');
      setEditingPosition(null);
      setEditingStyles(null);
    } finally {
      setIsSaving(false);
    }
  }, [pdfDoc, editingElement, editingText, editingPosition, editingStyles, pageNumber, fileUrl, file, hideEditedSpans]);

  // Handle input changes
  useEffect(() => {
    if (editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingPosition]);

  // Annotation handlers
  const handleAnnotationMouseDown = (e: React.MouseEvent) => {
    if (annotationMode === 'none' || !pageContainerRef.current) return;
    
    const target = e.target as HTMLElement;
    if (target.closest('.text-edit-overlay') || target.closest('.annotation-overlay')) {
      return;
    }
    
    e.preventDefault();
    e.stopPropagation();
    
    const pageElement = pageContainerRef.current.querySelector('.react-pdf__Page');
    const pageRect = pageElement?.getBoundingClientRect();
    const containerRect = pageContainerRef.current.getBoundingClientRect();
    
    if (!pageRect) return;
    
    // Calculate coordinates relative to the container (for overlay positioning)
    const containerX = e.clientX - containerRect.left;
    const containerY = e.clientY - containerRect.top;
    
    setIsDrawing(true);
    setDrawStart({ x: containerX, y: containerY }); // Store container-relative for overlay
    setCurrentAnnotation({ 
      x: containerX,
      y: containerY, 
      width: 0, 
      height: 0 
    });
  };

  const handleAnnotationMouseMove = (e: React.MouseEvent) => {
    if (!isDrawing || !drawStart || !pageContainerRef.current) return;
    
    const containerRect = pageContainerRef.current.getBoundingClientRect();
    if (!containerRect) return;
    
    // Calculate container-relative coordinates for overlay
    const containerX = e.clientX - containerRect.left;
    const containerY = e.clientY - containerRect.top;
    
    const width = containerX - drawStart.x;
    const height = containerY - drawStart.y;
    
    setCurrentAnnotation({
      x: Math.min(drawStart.x, containerX),
      y: Math.min(drawStart.y, containerY),
      width: Math.abs(width),
      height: Math.abs(height),
    });
  };

  const handleAnnotationMouseUp = async () => {
    if (!isDrawing || !drawStart || !currentAnnotation || !pdfDoc || !pageContainerRef.current) {
      setIsDrawing(false);
      setDrawStart(null);
      setCurrentAnnotation(null);
      return;
    }
    
    const pageElement = pageContainerRef.current.querySelector('.react-pdf__Page');
    const pageRect = pageElement?.getBoundingClientRect();
    const containerRect = pageContainerRef.current.getBoundingClientRect();
    
    if (!pageRect || !containerRect) {
      setIsDrawing(false);
      setDrawStart(null);
      setCurrentAnnotation(null);
      return;
    }
    
    // Convert container-relative coordinates to page-relative coordinates
    const pageX = currentAnnotation.x - (pageRect.left - containerRect.left);
    const pageY = currentAnnotation.y - (pageRect.top - containerRect.top);
    
    if (currentAnnotation.width < 5 || currentAnnotation.height < 5) {
      // Too small, treat as click for notes
      if (annotationMode === 'note') {
        const noteText = prompt('Enter note text:');
        if (noteText) {
          await addAnnotation({
            type: 'note',
            x: pageX,
            y: pageY,
            width: 100,
            height: 100,
            text: noteText,
          });
        }
      }
      setIsDrawing(false);
      setDrawStart(null);
      setCurrentAnnotation(null);
      return;
    }
    
    // For sticky notes, always prompt for text
    let annotationText: string | undefined;
    if (annotationMode === 'note') {
      const promptResult = prompt('Enter note text:');
      if (!promptResult) {
        // User cancelled, don't add annotation
        setIsDrawing(false);
        setDrawStart(null);
        setCurrentAnnotation(null);
        return;
      }
      annotationText = promptResult;
    }
    
    // Add annotation based on mode (using page-relative coordinates)
    await addAnnotation({
      type: annotationMode as 'highlight' | 'note' | 'textbox' | 'redact',
      x: pageX,
      y: pageY,
      width: currentAnnotation.width,
      height: currentAnnotation.height,
      text: annotationText,
    });
    
    setIsDrawing(false);
    setDrawStart(null);
    setCurrentAnnotation(null);
  };

  const addAnnotation = async (annotation: {
    type: 'highlight' | 'note' | 'textbox' | 'redact';
    x: number;
    y: number;
    width: number;
    height: number;
    text?: string;
    color?: string;
  }) => {
    if (!pdfDoc) return;
    
    try {
      const page = pdfDoc.getPage(pageNumber - 1);
      const { width: pageWidth, height: pageHeight } = page.getSize();
      
      // Get the rendered page dimensions
      const pageElement = pageContainerRef.current?.querySelector('.react-pdf__Page');
      if (!pageElement) return;
      
      const pageStyle = window.getComputedStyle(pageElement);
      const renderedWidth = parseFloat(pageStyle.width);
      const renderedHeight = parseFloat(pageStyle.height);
      
      // Calculate scale
      const scaleX = pageWidth / renderedWidth;
      const scaleY = pageHeight / renderedHeight;
      
      // Convert screen coordinates to PDF coordinates
      const pdfX = annotation.x * scaleX;
      const pdfY = pageHeight - (annotation.y * scaleY);
      const pdfWidth = annotation.width * scaleX;
      const pdfHeight = annotation.height * scaleY;
      
      const { rgb, PDFDocument } = await import('pdf-lib');
      
      if (annotation.type === 'highlight') {
        // Add highlight annotation
        page.drawRectangle({
          x: pdfX,
          y: pdfY - pdfHeight,
          width: pdfWidth,
          height: pdfHeight,
          color: rgb(1, 1, 0), // Yellow highlight
          opacity: 0.3,
        });
      } else if (annotation.type === 'redact') {
        // Add redaction (black rectangle)
        page.drawRectangle({
          x: pdfX,
          y: pdfY - pdfHeight,
          width: pdfWidth,
          height: pdfHeight,
          color: rgb(0, 0, 0),
          opacity: 1,
        });
      } else if (annotation.type === 'textbox') {
        // Add text box
        const text = annotation.text || prompt('Enter text:') || '';
        if (text) {
          const { StandardFonts } = await import('pdf-lib');
          const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
          page.drawText(text, {
            x: pdfX,
            y: pdfY - pdfHeight,
            size: 12,
            font: font,
            color: rgb(0, 0, 0),
          });
        }
      } else if (annotation.type === 'note') {
        // Add sticky note (small square with text)
        const text = annotation.text || '';
        if (text) {
          // Draw note background
          page.drawRectangle({
            x: pdfX,
            y: pdfY - 20,
            width: 100 * scaleX,
            height: 20 * scaleY,
            color: rgb(1, 1, 0.8), // Light yellow
            opacity: 0.9,
          });
          // Draw note text
          const { StandardFonts } = await import('pdf-lib');
          const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
          page.drawText(text, {
            x: pdfX + 2,
            y: pdfY - 15,
            size: 10,
            font: font,
            color: rgb(0, 0, 0),
          });
        }
      }
      
      // Save PDF
      const pdfBytes = await pdfDoc.save();
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      
      // Reload PDF
      const updatedPdfDoc = await PDFDocument.load(await blob.arrayBuffer());
      setPdfDoc(updatedPdfDoc);
      
      // Update file URL
      if (fileUrl) {
        URL.revokeObjectURL(fileUrl);
      }
      const newUrl = URL.createObjectURL(blob);
      setFileUrl(newUrl);
      
      const newFile = new File([blob], file?.name || 'annotated.pdf', { type: 'application/pdf' });
      setFile(newFile);
      
      // Add to annotations list
      const newAnnotation = {
        id: `annotation-${Date.now()}`,
        page: pageNumber,
        ...annotation,
      };
      setAnnotations([...annotations, newAnnotation]);
      
    } catch (error) {
      console.error('Error adding annotation:', error);
      alert('Failed to add annotation. Please try again.');
    }
  };

  // Disable panning when in edit mode or annotation mode
  const handleMouseDownEdit = (e: React.MouseEvent) => {
    if (isEditMode) {
      // Allow text editing, prevent panning
      const target = e.target as HTMLElement;
      if (target.closest('.react-pdf__Page__textContent') || target.closest('.text-edit-overlay')) {
        return; // Let text editing handle it
      }
      e.preventDefault();
    } else if (annotationMode !== 'none') {
      handleAnnotationMouseDown(e);
    } else {
      handleMouseDown(e);
    }
  };

  const cancelEdit = () => {
    setEditingElement(null);
    setEditingText('');
    setEditingPosition(null);
    setEditingStyles(null);
  };

  // Prevent hydration mismatch - don't render until mounted
  if (!isMounted) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 flex items-center justify-center">
        <div className="text-slate-600 dark:text-slate-400">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800">
      <div className="container mx-auto px-4 py-4 h-screen flex flex-col">
        <header className="mb-4">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-1">
            PDF Viewer
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Drop a PDF file or click to browse
          </p>
        </header>

        {!file || !fileUrl || !isPdfReady ? (
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            className={`
              border-2 border-dashed rounded-2xl p-16 text-center transition-all duration-300
              ${isDragOver 
                ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' 
                : 'border-slate-300 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-600'
              }
            `}
          >
            <div className="flex flex-col items-center space-y-4">
              <svg
                className="w-16 h-16 text-slate-400 dark:text-slate-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                />
              </svg>
              <div>
                <label
                  htmlFor="file-upload"
                  className="cursor-pointer text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-medium"
                >
                  Choose a PDF file
                </label>
                <input
                  id="file-upload"
                  type="file"
                  accept="application/pdf"
                  onChange={handleFileChange}
                  className="hidden"
                />
                <span className="text-slate-600 dark:text-slate-400"> or drag and drop</span>
              </div>
              <p className="text-sm text-slate-500 dark:text-slate-500">
                PDF files only
              </p>
            </div>
          </div>
        ) : (
          <div className="flex gap-4 flex-1 min-h-0">
            {/* Thumbnail Sidebar */}
            <aside className="w-40 flex-shrink-0 bg-white dark:bg-slate-800 rounded-xl shadow-lg p-3 overflow-y-auto">
              <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-4">
                Pages ({numPages})
              </h2>
              <div className="space-y-3">
                {Array.from({ length: numPages }, (_, i) => i + 1).map((page) => (
                  <button
                    key={page}
                    onClick={() => goToPage(page)}
                    className={`
                      w-full p-2 rounded-lg transition-all duration-200 text-left
                      ${pageNumber === page
                        ? 'bg-blue-500 text-white shadow-md'
                        : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
                      }
                    `}
                  >
                    <div className="relative aspect-[3/4] mb-2 bg-white dark:bg-slate-600 rounded overflow-hidden">
                      {fileUrl && (
                        <Document
                          file={fileUrl}
                          loading={<div className="w-full h-full flex items-center justify-center text-xs">Loading...</div>}
                        >
                          <Page
                            pageNumber={page}
                            width={120}
                            renderTextLayer={false}
                            renderAnnotationLayer={false}
                          />
                        </Document>
                      )}
                    </div>
                    <div className="text-xs font-medium">Page {page}</div>
                  </button>
                ))}
              </div>
            </aside>

            {/* Main PDF Viewer */}
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
              {/* Toolbar */}
              <div className="bg-white dark:bg-slate-800 rounded-xl shadow-lg p-2 mb-2 flex items-center justify-between flex-wrap gap-2 flex-shrink-0">
                <div className="flex items-center gap-4">
                  <button
                    onClick={handleNewPdf}
                    className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
                  >
                    ← New PDF
                  </button>
                  <div className="h-6 w-px bg-slate-300 dark:bg-slate-600" />
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setPageNumber((prev) => Math.max(1, prev - 1))}
                      disabled={pageNumber <= 1}
                      className="px-3 py-1.5 text-sm font-medium bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      Previous
                    </button>
                    <span className="px-4 py-1.5 text-sm font-medium text-slate-700 dark:text-slate-300">
                      {pageNumber} / {numPages}
                    </span>
                    <button
                      onClick={() => setPageNumber((prev) => Math.min(numPages, prev + 1))}
                      disabled={pageNumber >= numPages}
                      className="px-3 py-1.5 text-sm font-medium bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      Next
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={zoomOut}
                    className="px-3 py-1.5 text-sm font-medium bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
                  >
                    −
                  </button>
                  <span className="px-4 py-1.5 text-sm font-medium text-slate-700 dark:text-slate-300 min-w-[4rem] text-center">
                    {Math.round(scale * 100)}%
                  </span>
                  <button
                    onClick={zoomIn}
                    className="px-3 py-1.5 text-sm font-medium bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
                  >
                    +
                  </button>
                  <button
                    onClick={resetZoom}
                    className="px-3 py-1.5 text-sm font-medium bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
                  >
                    Reset
                  </button>
                  <div className="h-6 w-px bg-slate-300 dark:bg-slate-600" />
                  <button
                    onClick={() => {
                      setIsEditMode(!isEditMode);
                      setAnnotationMode('none');
                    }}
                    className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                      isEditMode
                        ? 'bg-green-500 text-white hover:bg-green-600'
                        : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
                    }`}
                  >
                    {isEditMode ? '✓ Edit Mode' : '✎ Edit Text'}
                  </button>
                  <div className="h-6 w-px bg-slate-300 dark:bg-slate-600" />
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => {
                        setAnnotationMode(annotationMode === 'highlight' ? 'none' : 'highlight');
                        setIsEditMode(false);
                      }}
                      className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                        annotationMode === 'highlight'
                          ? 'bg-yellow-500 text-white hover:bg-yellow-600'
                          : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
                      }`}
                      title="Highlight"
                    >
                      🖍️
                    </button>
                    <button
                      onClick={() => {
                        setAnnotationMode(annotationMode === 'note' ? 'none' : 'note');
                        setIsEditMode(false);
                      }}
                      className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                        annotationMode === 'note'
                          ? 'bg-yellow-400 text-white hover:bg-yellow-500'
                          : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
                      }`}
                      title="Sticky Note"
                    >
                      📝
                    </button>
                    <button
                      onClick={() => {
                        setAnnotationMode(annotationMode === 'textbox' ? 'none' : 'textbox');
                        setIsEditMode(false);
                      }}
                      className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                        annotationMode === 'textbox'
                          ? 'bg-blue-500 text-white hover:bg-blue-600'
                          : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
                      }`}
                      title="Text Box"
                    >
                      📄
                    </button>
                    <button
                      onClick={() => {
                        setAnnotationMode(annotationMode === 'redact' ? 'none' : 'redact');
                        setIsEditMode(false);
                      }}
                      className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                        annotationMode === 'redact'
                          ? 'bg-red-600 text-white hover:bg-red-700'
                          : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
                      }`}
                      title="Redact"
                    >
                      ⬛
                    </button>
                  </div>
                  <div className="h-6 w-px bg-slate-300 dark:bg-slate-600" />
                  <button
                    onClick={() => setShowCommitModal(true)}
                    className="px-4 py-1.5 text-sm font-medium bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition-colors"
                    title="Commit New Version"
                  >
                    💾 Commit Version
                  </button>
                  {versions.length > 0 && (
                    <>
                      <div className="h-6 w-px bg-slate-300 dark:bg-slate-600" />
                      <button
                        onClick={exportAnnotatedPdf}
                        className="px-4 py-1.5 text-sm font-medium bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors"
                        title="Export Annotated PDF"
                      >
                        📄 Export Annotated PDF
                      </button>
                    </>
                  )}
                </div>
              </div>
              
              {/* Version Control Bar */}
              {versions.length > 0 && (
                <div className="bg-white dark:bg-slate-800 rounded-lg shadow-md p-2 mb-2 flex-shrink-0">
                  <div className="flex items-center justify-center gap-2 flex-wrap">
                    {/* Previous Version Arrow */}
                    <button
                      onClick={() => {
                        const prevVersion = currentVersion > 1 ? currentVersion - 1 : currentVersion;
                        if (prevVersion !== currentVersion) {
                          switchVersion(prevVersion);
                        }
                      }}
                      disabled={currentVersion <= 1}
                      className="px-2 py-1 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      title="Previous version"
                    >
                      ←
                    </button>
                    
                    {/* Version List */}
                    <div className="flex items-center gap-1 overflow-x-auto max-w-full scrollbar-hide">
                      {versions.map((version, index) => (
                        <div key={version.id} className="flex items-center">
                          <button
                            onClick={async () => {
                              if (diffMode) {
                                if (diffVersions.v1 === null) {
                                  // Select first version
                                  setDiffVersions({ v1: version.version, v2: null });
                                } else if (diffVersions.v2 === null && diffVersions.v1 !== version.version) {
                                  // Select second version and compare
                                  const v1 = diffVersions.v1;
                                  const v2 = version.version;
                                  setDiffVersions({ v1, v2 });
                                  await compareVersions(v1, v2);
                                } else {
                                  // Reset and select new first version
                                  setDiffVersions({ v1: version.version, v2: null });
                                  setTextDiffs([]);
                                  setDiffsReady(false);
                                }
                              } else {
                                switchVersion(version.version);
                              }
                            }}
                            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all relative group ${
                              currentVersion === version.version
                                ? 'bg-purple-500 text-white shadow-md scale-105'
                                : diffMode && (diffVersions.v1 === version.version || diffVersions.v2 === version.version)
                                ? 'bg-blue-500 text-white'
                                : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
                            }`}
                            title={`${version.message} - ${version.timestamp.toLocaleString()}`}
                          >
                            V{version.version}
                            {/* Tooltip on hover */}
                            <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 hidden group-hover:block z-50">
                              <div className="bg-slate-900 dark:bg-slate-700 text-white text-xs rounded py-1.5 px-3 shadow-lg whitespace-nowrap max-w-xs">
                                <div className="font-semibold mb-1">{version.message}</div>
                                <div className="text-slate-300 text-[10px]">
                                  {version.timestamp.toLocaleString()}
                                </div>
                                <div className="absolute bottom-0 left-1/2 transform -translate-x-1/2 translate-y-full">
                                  <div className="border-4 border-transparent border-t-slate-900 dark:border-t-slate-700"></div>
                                </div>
                              </div>
                            </div>
                          </button>
                          {index < versions.length - 1 && (
                            <span className="mx-1 text-slate-400 dark:text-slate-500">|</span>
                          )}
                        </div>
                      ))}
                    </div>
                    
                    {/* Next Version Arrow */}
                    <button
                      onClick={() => {
                        const nextVersion = currentVersion < versions.length ? currentVersion + 1 : currentVersion;
                        if (nextVersion !== currentVersion) {
                          switchVersion(nextVersion);
                        }
                      }}
                      disabled={currentVersion >= versions.length}
                      className="px-2 py-1 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      title="Next version"
                    >
                      →
                    </button>
                    
                    {/* Diff Mode Toggle */}
                    <div className="h-6 w-px bg-slate-300 dark:bg-slate-600" />
                    <button
                      onClick={() => {
                        if (diffMode) {
                          setDiffMode(false);
                          setDiffVersions({ v1: null, v2: null });
                          setTextDiffs([]);
                          setDiffsReady(false);
                        } else {
                          setDiffMode(true);
                          setDiffVersions({ v1: null, v2: null });
                        }
                      }}
                      className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                        diffMode
                          ? 'bg-green-500 text-white hover:bg-green-600'
                          : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
                      }`}
                      title="Compare versions"
                    >
                      🔍 Diff
                    </button>
                    
                    {diffMode && (
                      <>
                        <span className="text-xs text-slate-500 dark:text-slate-400">
                          Select V{diffVersions.v1 || '?'} vs V{diffVersions.v2 || '?'}
                        </span>
                        {(diffVersions.v1 || diffVersions.v2) && (
                          <button
                            onClick={() => {
                              setDiffVersions({ v1: null, v2: null });
                              setTextDiffs([]);
                              setDiffsReady(false);
                            }}
                            className="px-2 py-1 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                          >
                            Clear
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )}
              
              {/* PDF Canvas */}
              <div
                ref={pageContainerRef}
                className="flex-1 bg-slate-200 dark:bg-slate-900 rounded-xl shadow-lg overflow-hidden relative min-h-0"
                onMouseDown={handleMouseDownEdit}
                onMouseMove={
                  isEditMode 
                    ? undefined 
                    : annotationMode !== 'none' 
                      ? handleAnnotationMouseMove 
                      : handleMouseMove
                }
                onMouseUp={
                  isEditMode 
                    ? undefined 
                    : annotationMode !== 'none' 
                      ? handleAnnotationMouseUp 
                      : handleMouseUp
                }
                onMouseLeave={
                  isEditMode 
                    ? undefined 
                    : annotationMode !== 'none' 
                      ? handleAnnotationMouseUp 
                      : handleMouseUp
                }
                onWheel={handleWheel}
                style={{ 
                  cursor: isEditMode 
                    ? 'text' 
                    : annotationMode !== 'none' 
                      ? 'crosshair' 
                      : isDragging 
                        ? 'grabbing' 
                        : 'grab' 
                }}
              >
                <div
                  className="absolute inset-0 flex items-center justify-center"
                  style={{
                    transform: `translate(${position.x}px, ${position.y}px)`,
                    transition: isDragging ? 'none' : 'transform 0.1s ease-out',
                  }}
                >
                  {fileUrl && (
                    <Document
                      key={fileUrl} // Force reload when URL changes
                      file={fileUrl}
                      onLoadSuccess={onDocumentLoadSuccess}
                      loading={
                        <div className="text-slate-500 dark:text-slate-400">
                          Loading PDF...
                        </div>
                      }
                      error={
                        <div className="text-red-500 p-4">
                          Failed to load PDF. Please try another file.
                        </div>
                      }
                    >
                      <Page
                        pageNumber={pageNumber}
                        scale={scale}
                        renderTextLayer={true}
                        renderAnnotationLayer={true}
                        className="shadow-2xl"
                      />
                    </Document>
                  )}
                </div>
                
                {/* Annotation Drawing Overlay */}
                {currentAnnotation && annotationMode !== 'none' && (
                  <div
                    className="annotation-overlay absolute z-40 pointer-events-none"
                    style={{
                      left: `${currentAnnotation.x}px`,
                      top: `${currentAnnotation.y}px`,
                      width: `${currentAnnotation.width}px`,
                      height: `${currentAnnotation.height}px`,
                      border: '2px dashed',
                      borderColor: 
                        annotationMode === 'highlight' ? '#fbbf24' :
                        annotationMode === 'note' ? '#facc15' :
                        annotationMode === 'textbox' ? '#3b82f6' :
                        '#dc2626',
                      backgroundColor:
                        annotationMode === 'highlight' ? 'rgba(251, 191, 36, 0.2)' :
                        annotationMode === 'note' ? 'rgba(250, 204, 21, 0.2)' :
                        annotationMode === 'textbox' ? 'rgba(59, 130, 246, 0.1)' :
                        'rgba(220, 38, 38, 0.3)',
                    }}
                  />
                )}

                {/* Diff Overlay */}
                {diffMode && textDiffs.length > 0 && (
                  <>
                    {textDiffs
                      .filter(diff => !diff.page || diff.page === pageNumber) // Filter by current page for annotation diffs
                      .map((diff, index) => {
                      // Get the page element to calculate correct position
                      const pageElement = pageContainerRef.current?.querySelector('.react-pdf__Page');
                      const pageRect = pageElement?.getBoundingClientRect();
                      const containerRect = pageContainerRef.current?.getBoundingClientRect();
                      
                      // If page isn't ready yet, return null (will render on next update when PDF loads)
                      if (!pageRect || !containerRect || !pageElement) {
                        return null;
                      }
                      
                      // Verify canvas exists and has content (PDF is rendered)
                      const canvas = pageElement.querySelector('canvas');
                      if (!canvas || canvas.width === 0) {
                        return null;
                      }
                      
                      // diff.x and diff.y are relative to the page element (from extractTextFromCurrentPdf)
                      // The page is inside a transformed div, so getBoundingClientRect() already includes the pan offset
                      // We just need to get the page position relative to container and add diff coordinates
                      const pageX = pageRect.left - containerRect.left;
                      const pageY = pageRect.top - containerRect.top;
                      
                      // The coordinates from extractTextFromCurrentPdf are already in screen pixels
                      // at the current scale. pageRect already accounts for the transform, so don't add position.x/y again
                      return (
                        <div
                          key={index}
                          className="absolute z-30 pointer-events-none"
                          style={{
                            left: `${pageX + diff.x}px`,
                            top: `${pageY + diff.y}px`,
                            width: `${diff.width}px`,
                            height: `${diff.height}px`,
                            backgroundColor:
                              diff.type === 'added' ? (diff.isAnnotation ? 'rgba(34, 197, 94, 0.4)' : 'rgba(34, 197, 94, 0.3)') :
                              diff.type === 'deleted' ? (diff.isAnnotation ? 'rgba(239, 68, 68, 0.4)' : 'rgba(239, 68, 68, 0.3)') :
                              (diff.isAnnotation ? 'rgba(251, 191, 36, 0.4)' : 'rgba(251, 191, 36, 0.3)'),
                            border: `2px ${diff.isAnnotation ? 'dashed' : 'solid'} ${
                              diff.type === 'added' ? '#22c55e' :
                              diff.type === 'deleted' ? '#ef4444' :
                              '#fbbf24'
                            }`,
                            borderRadius: '2px',
                          }}
                          title={`${diff.type === 'added' ? 'Added' : diff.type === 'deleted' ? 'Deleted' : 'Modified'}: ${diff.text}`}
                        />
                      );
                    })}
                  </>
                )}

                {/* Text Edit Overlay */}
                {editingPosition && editingStyles && (
                  <div
                    className="text-edit-overlay absolute z-50 pointer-events-auto"
                    style={{
                      left: `${editingPosition.x + position.x}px`,
                      top: `${editingPosition.y + position.y}px`,
                      minWidth: `${Math.max(editingPosition.width, 200)}px`,
                      transform: `scale(${scale})`,
                      transformOrigin: 'top left',
                    }}
                  >
                    <input
                      ref={editInputRef}
                      type="text"
                      value={editingText}
                      onChange={(e) => setEditingText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          saveTextEdit();
                        } else if (e.key === 'Escape') {
                          e.preventDefault();
                          cancelEdit();
                        }
                        e.stopPropagation();
                      }}
                      onClick={(e) => e.stopPropagation()}
                      onMouseDown={(e) => e.stopPropagation()}
                      className="w-full px-2 py-1 border-2 border-blue-500 rounded shadow-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      style={{
                        fontSize: editingStyles.fontSize,
                        fontFamily: editingStyles.fontFamily,
                        fontWeight: editingStyles.fontWeight,
                        fontStyle: editingStyles.fontStyle,
                        color: editingStyles.color || '#000000',
                        letterSpacing: editingStyles.letterSpacing,
                        lineHeight: editingStyles.lineHeight,
                        textDecoration: editingStyles.textDecoration || 'none',
                        textTransform: editingStyles.textTransform || 'none',
                        // Force the color to be applied - override any CSS
                        WebkitTextFillColor: editingStyles.color || '#000000',
                        caretColor: editingStyles.color || '#000000',
                        // White background unless text color is white/light
                        backgroundColor: (() => {
                          const color = editingStyles.color || '#000000';
                          // Check if color is white or very light
                          if (color.includes('rgb')) {
                            const match = color.match(/\d+/g);
                            if (match && match.length >= 3) {
                              const r = parseInt(match[0]);
                              const g = parseInt(match[1]);
                              const b = parseInt(match[2]);
                              // If color is white or very light (close to white), use dark background
                              if (r > 240 && g > 240 && b > 240) {
                                return '#1a1a1a'; // Dark background for white text
                              }
                            }
                          } else if (color === 'white' || color === '#ffffff' || color === '#fff') {
                            return '#1a1a1a'; // Dark background for white text
                          }
                          return 'white'; // White background for colored/dark text
                        })(),
                      } as React.CSSProperties}
                    />
                    <div className="mt-1 flex gap-2 text-xs">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          saveTextEdit();
                        }}
                        disabled={isSaving}
                        className="px-2 py-1 bg-green-500 text-white rounded hover:bg-green-600 disabled:opacity-50"
                      >
                        {isSaving ? 'Saving...' : 'Save'}
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          cancelEdit();
                        }}
                        className="px-2 py-1 bg-red-500 text-white rounded hover:bg-red-600"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="mt-2 text-xs text-slate-500 dark:text-slate-400 text-center flex-shrink-0">
                <p>
                  {isEditMode 
                    ? '✎ Edit Mode: Click on any text to edit it. Font and size are preserved.'
                    : annotationMode !== 'none'
                      ? `📝 ${annotationMode === 'highlight' ? 'Highlight' : annotationMode === 'note' ? 'Sticky Note' : annotationMode === 'textbox' ? 'Text Box' : 'Redact'} Mode: Click and drag to add annotation.`
                      : '💡 Tip: Use Ctrl/Cmd + Scroll to zoom, drag to pan. Click "Edit Text" to enable inline editing, or use annotation tools.'
                  }
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
      
      {/* Commit Version Modal */}
      {showCommitModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl p-6 max-w-md w-full mx-4">
            <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-4">
              Commit New Version (V{currentVersion + 1})
            </h2>
            <div className="mb-4">
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                Version Message
              </label>
              <textarea
                value={commitMessage}
                onChange={(e) => setCommitMessage(e.target.value)}
                placeholder="e.g., Added redactions on p.3, updated figure caption"
                className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                rows={3}
                autoFocus
              />
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowCommitModal(false);
                  setCommitMessage('');
                }}
                className="flex-1 px-4 py-2 text-sm font-medium bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={commitVersion}
                className="flex-1 px-4 py-2 text-sm font-medium bg-purple-500 text-white rounded-lg hover:bg-purple-600 transition-colors"
              >
                Commit Version
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

