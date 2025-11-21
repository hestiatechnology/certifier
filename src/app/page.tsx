'use client';

import React, { useState, useEffect } from 'react';
import { FileUploader } from '@/components/FileUploader';
import Papa from 'papaparse';
import { ArrowRight, CheckCircle, Download, Loader2 } from 'lucide-react';

export default function Home() {
  const [docxFile, setDocxFile] = useState<File | null>(null);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [docxPlaceholders, setDocxPlaceholders] = useState<string[]>([]);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvData, setCsvData] = useState<any[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [analyzing, setAnalyzing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Analyze DOCX when uploaded
  useEffect(() => {
    if (!docxFile) {
      setDocxPlaceholders([]);
      return;
    }

    const analyzeDocx = async () => {
      setAnalyzing(true);
      setError(null);
      try {
        const formData = new FormData();
        formData.append('file', docxFile);

        const res = await fetch('/api/analyze', {
          method: 'POST',
          body: formData,
        });

        if (!res.ok) throw new Error('Failed to analyze DOCX');

        const data = await res.json();
        setDocxPlaceholders(data.placeholders || []);
      } catch (err) {
        console.error(err);
        setError('Error analyzing DOCX template. Make sure it is a valid .docx file.');
      } finally {
        setAnalyzing(false);
      }
    };

    analyzeDocx();
  }, [docxFile]);

  // Parse CSV when uploaded
  useEffect(() => {
    if (!csvFile) {
      setCsvHeaders([]);
      setCsvData([]);
      return;
    }

    Papa.parse(csvFile, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        if (results.meta.fields) {
          setCsvHeaders(results.meta.fields);
          setCsvData(results.data);
          
          // Auto-map logic: try to match exact names (case insensitive)
          const initialMapping: Record<string, string> = {};
          if (docxPlaceholders.length > 0) {
             docxPlaceholders.forEach(ph => {
                const match = results.meta.fields?.find(h => h.toLowerCase() === ph.toLowerCase());
                if (match) initialMapping[ph] = match;
             });
             setMapping(prev => ({ ...prev, ...initialMapping }));
          }
        }
      },
      error: (err) => {
        console.error(err);
        setError('Error parsing CSV file.');
      }
    });
  }, [csvFile, docxPlaceholders]); // Re-run auto-map if placeholders change

  const handleMappingChange = (placeholder: string, csvHeader: string) => {
    setMapping(prev => ({ ...prev, [placeholder]: csvHeader }));
  };

  const handleGenerate = async () => {
    if (!docxFile || !csvData.length) return;

    setGenerating(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('template', docxFile);
      formData.append('data', JSON.stringify(csvData));
      formData.append('mapping', JSON.stringify(mapping));

      const res = await fetch('/api/generate', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) throw new Error('Failed to generate certificates');

      // Trigger download
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'certificates.zip';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      console.error(err);
      setError('Error generating certificates. Please try again.');
    } finally {
      setGenerating(false);
    }
  };

  const isReady = docxFile && csvFile && docxPlaceholders.length > 0 && Object.keys(mapping).length > 0;

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8 font-[family-name:var(--font-geist-sans)]">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-10">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">Certifier</h1>
          <p className="text-lg text-gray-600">Generate bulk PDFs from DOCX templates and CSV data.</p>
        </div>

        {/* Upload Section */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          <div>
             <h2 className="text-lg font-semibold mb-3 text-gray-800">1. Upload Template (.docx)</h2>
             <FileUploader
               label="DOCX Template"
               accept=".docx"
               file={docxFile}
               setFile={setDocxFile}
               color="blue"
             />
             {analyzing && <p className="mt-2 text-sm text-blue-600 flex items-center"><Loader2 className="animate-spin w-4 h-4 mr-1"/> Analyzing template...</p>}
             {!analyzing && docxPlaceholders.length > 0 && (
                <div className="mt-3 bg-blue-50 p-3 rounded-md">
                  <p className="text-sm font-medium text-blue-800">Found {docxPlaceholders.length} placeholders:</p>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {docxPlaceholders.map(ph => (
                      <span key={ph} className="bg-white border border-blue-200 text-blue-600 px-2 py-1 rounded text-xs font-mono">
                        {`%${ph}%`}
                      </span>
                    ))}
                  </div>
                </div>
             )}
          </div>

          <div>
             <h2 className="text-lg font-semibold mb-3 text-gray-800">2. Upload Data (.csv)</h2>
             <FileUploader
               label="CSV Data"
               accept=".csv"
               file={csvFile}
               setFile={setCsvFile}
               color="green"
             />
             {csvHeaders.length > 0 && (
                <div className="mt-3 bg-green-50 p-3 rounded-md">
                   <p className="text-sm font-medium text-green-800">Found {csvData.length} rows with columns:</p>
                   <p className="text-xs text-green-600 mt-1">{csvHeaders.join(', ')}</p>
                </div>
             )}
          </div>
        </div>

        {/* Mapping Section */}
        {docxPlaceholders.length > 0 && csvHeaders.length > 0 && (
          <div className="bg-white shadow-sm rounded-lg p-6 mb-8 border border-gray-200">
            <h2 className="text-xl font-semibold mb-4 text-gray-800">3. Map Fields</h2>
            <p className="text-gray-500 text-sm mb-6">Match the placeholders in your DOCX template to the columns in your CSV file.</p>
            
            <div className="grid gap-4">
              {docxPlaceholders.map((ph) => (
                <div key={ph} className="flex items-center justify-between border-b border-gray-100 pb-4 last:border-0 last:pb-0">
                   <div className="flex items-center space-x-3">
                      <span className="font-mono text-sm bg-gray-100 px-3 py-1 rounded text-gray-700 min-w-[150px] text-center">
                        {`%${ph}%`}
                      </span>
                      <ArrowRight className="w-4 h-4 text-gray-400" />
                   </div>
                   <select
                     className="block w-1/2 rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm p-2 border text-gray-900"
                     value={mapping[ph] || ''}
                     onChange={(e) => handleMappingChange(ph, e.target.value)}
                   >
                     <option value="">-- Select CSV Column --</option>
                     {csvHeaders.map(header => (
                       <option key={header} value={header}>{header}</option>
                     ))}
                   </select>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Action Section */}
        <div className="flex flex-col items-center justify-center space-y-4">
           {error && (
             <div className="text-red-600 bg-red-50 px-4 py-2 rounded-md text-sm font-medium">
               {error}
             </div>
           )}
           
           <button
             onClick={handleGenerate}
             disabled={!isReady || generating}
             className={`
               flex items-center justify-center px-8 py-4 rounded-full text-lg font-bold text-white shadow-lg transition-all transform hover:scale-105
               ${!isReady || generating 
                 ? 'bg-gray-400 cursor-not-allowed' 
                 : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-blue-500/30'}
             `}
           >
             {generating ? (
               <>
                 <Loader2 className="animate-spin w-6 h-6 mr-2" />
                 Generating Certificates...
               </>
             ) : (
               <>
                 <Download className="w-6 h-6 mr-2" />
                 Generate & Download ZIP
               </>
             )}
           </button>
           
           {isReady && !generating && (
             <p className="text-sm text-gray-500">Ready to process {csvData.length} records.</p>
           )}
        </div>
      </div>
    </div>
  );
}