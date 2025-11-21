'use client';

import React, { useState, useEffect } from 'react';
import { FileUploader } from '@/components/FileUploader';
import Papa from 'papaparse';
import { ArrowRight, Download, Loader2, Layers, Info } from 'lucide-react';
import { clsx } from 'clsx';

export default function Home() {
  const [docxFile, setDocxFile] = useState<File | null>(null);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [docxPlaceholders, setDocxPlaceholders] = useState<string[]>([]);
  const [docxLoops, setDocxLoops] = useState<string[]>([]);
  
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvData, setCsvData] = useState<any[]>([]);
  
  const [mapping, setMapping] = useState<Record<string, string>>({});
  
  // Grouping State
  const [enableGrouping, setEnableGrouping] = useState(false);
  const [groupByCol, setGroupByCol] = useState<string>('');

  const [analyzing, setAnalyzing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Analyze DOCX
  useEffect(() => {
    if (!docxFile) {
      setDocxPlaceholders([]);
      setDocxLoops([]);
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
        setDocxLoops(data.loops || []);
        
        // Auto-enable grouping if loops are detected
        if (data.loops && data.loops.length > 0) {
            setEnableGrouping(true);
        }
      } catch (err) {
        console.error(err);
        setError('Error analyzing DOCX template. Make sure it is a valid .docx file.');
      } finally {
        setAnalyzing(false);
      }
    };

    analyzeDocx();
  }, [docxFile]);

  // Parse CSV
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
          
          // Auto-map
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
  }, [csvFile, docxPlaceholders]);

  const handleMappingChange = (placeholder: string, csvHeader: string) => {
    setMapping(prev => ({ ...prev, [placeholder]: csvHeader }));
  };

  const handleGenerate = async () => {
    if (!docxFile || !csvData.length) return;

    setGenerating(true);
    setError(null);

    try {
      // 1. Transform Data Locally
      const mappedData = csvData.map(row => {
        const newRow: any = {};
        for (const [ph, header] of Object.entries(mapping)) {
           newRow[ph] = row[header] || "";
        }
        // Also keep original keys just in case, or for debugging? 
        // No, let's keep it clean. Only mapped keys.
        return newRow;
      });

      let finalData = mappedData;

      if (enableGrouping && groupByCol && docxLoops.length > 0) {
          // Grouping Logic
          const groups: Record<string, any[]> = {};
          
          // Find the mapping key that corresponds to the groupByCol (CSV Header)
          // We need to group by the VALUE of the CSV column.
          // mappedData keys are Placeholders. 
          // We need to look up the value using the mapping.
          
          // Actually, it's safer to group using the raw CSV data first, then map?
          // Or finding which placeholder maps to the groupByCol.
          // Let's use the raw CSV row to find the group key, to avoid ambiguity.
          
          csvData.forEach((rawRow, index) => {
             const groupKey = rawRow[groupByCol];
             if (!groups[groupKey]) groups[groupKey] = [];
             groups[groupKey].push(mappedData[index]);
          });

          finalData = Object.values(groups).map(groupItems => {
             const rootItem = { ...groupItems[0] }; // Clone first item as root
             // Assign the full list to every loop key found
             docxLoops.forEach(loopName => {
                 rootItem[loopName] = groupItems;
             });
             return rootItem;
          });
      }

      const formData = new FormData();
      formData.append('template', docxFile);
      // Send the fully transformed data. No mapping needed on backend.
      formData.append('data', JSON.stringify(finalData));
      formData.append('mapping', JSON.stringify({})); 

      const res = await fetch('/api/generate', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) throw new Error('Failed to generate certificates');

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
  const isGroupingValid = !enableGrouping || (enableGrouping && groupByCol !== '');

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
                  <p className="text-sm font-medium text-blue-800">Found {docxPlaceholders.length} placeholders & {docxLoops.length} loops:</p>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {docxPlaceholders.map(ph => (
                      <span key={ph} className="bg-white border border-blue-200 text-blue-600 px-2 py-1 rounded text-xs font-mono">
                        {`%${ph}%`}
                      </span>
                    ))}
                    {docxLoops.map(loop => (
                      <span key={loop} className="bg-white border border-indigo-200 text-indigo-600 px-2 py-1 rounded text-xs font-mono font-bold">
                        {`{#${loop}}`}
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

        {/* Grouping Section */}
        {docxLoops.length > 0 && csvHeaders.length > 0 && (
           <div className={clsx("shadow-sm rounded-lg p-6 mb-8 border transition-all", enableGrouping ? "bg-indigo-50 border-indigo-200" : "bg-white border-gray-200")}>
               <div className="flex items-center justify-between mb-4">
                   <div className="flex items-center space-x-2">
                       <Layers className={clsx("w-5 h-5", enableGrouping ? "text-indigo-600" : "text-gray-400")} />
                       <h2 className={clsx("text-xl font-semibold", enableGrouping ? "text-indigo-900" : "text-gray-800")}>
                           4. Group Data (Dynamic Tables)
                       </h2>
                   </div>
                   <label className="relative inline-flex items-center cursor-pointer">
                      <input type="checkbox" checked={enableGrouping} onChange={(e) => setEnableGrouping(e.target.checked)} className="sr-only peer" />
                      <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-indigo-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                   </label>
               </div>
               
               {enableGrouping && (
                   <div className="animate-in fade-in slide-in-from-top-2">
                       <p className="text-sm text-indigo-700 mb-4 flex items-start">
                           <Info className="w-4 h-4 mr-1 mt-0.5 flex-shrink-0" />
                           Create one PDF per group instead of one per row. <br/>
                           The list of items in the group will be inserted into the template loop: <b>{docxLoops.map(l => `{#${l}}`).join(', ')}</b>.
                       </p>
                       <div className="flex items-center space-x-4">
                           <label className="text-sm font-medium text-gray-700">Group rows by unique:</label>
                           <select 
                               className="block w-64 rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm p-2 border text-gray-900"
                               value={groupByCol}
                               onChange={(e) => setGroupByCol(e.target.value)}
                           >
                               <option value="">-- Select Column (e.g. ID or Email) --</option>
                               {csvHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                           </select>
                       </div>
                   </div>
               )}
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
             disabled={!isReady || generating || !isGroupingValid}
             className={clsx(
               "flex items-center justify-center px-8 py-4 rounded-full text-lg font-bold text-white shadow-lg transition-all transform hover:scale-105",
               (!isReady || generating || !isGroupingValid)
                 ? 'bg-gray-400 cursor-not-allowed' 
                 : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-blue-500/30'
             )}
           >
             {generating ? (
               <>
                 <Loader2 className="animate-spin w-6 h-6 mr-2" />
                 Generating...
               </>
             ) : (
               <>
                 <Download className="w-6 h-6 mr-2" />
                 Generate & Download ZIP
               </>
             )}
           </button>
           
           {isReady && !generating && (
             <p className="text-sm text-gray-500">
                {enableGrouping && groupByCol 
                    ? `Ready to generate groups based on '${groupByCol}'.` 
                    : `Ready to process ${csvData.length} records.`}
             </p>
           )}
        </div>
      </div>
    </div>
  );
}