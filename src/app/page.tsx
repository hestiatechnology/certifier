'use client';

import React, { useState, useEffect } from 'react';
import { FileUploader } from '@/components/FileUploader';
import Papa from 'papaparse';
import { ArrowRight, Download, Loader2, Layers, Info, Mail } from 'lucide-react';
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

  // Delivery State
  const [deliveryMethod, setDeliveryMethod] = useState<'download' | 'email'>('download');
  const [email, setEmail] = useState('');
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

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
    setSuccessMessage(null);

    try {
      // 1. Transform Data Locally
      const mappedData = csvData.map(row => {
        const newRow: any = {};
        for (const [ph, header] of Object.entries(mapping)) {
           newRow[ph] = row[header] || "";
        }
        return newRow;
      });

      let finalData = mappedData;

      if (enableGrouping && groupByCol && docxLoops.length > 0) {
          const groups: Record<string, any[]> = {};
          
          csvData.forEach((rawRow, index) => {
             const groupKey = rawRow[groupByCol];
             if (!groups[groupKey]) groups[groupKey] = [];
             groups[groupKey].push(mappedData[index]);
          });

          finalData = Object.values(groups).map(groupItems => {
             const rootItem = { ...groupItems[0] };
             docxLoops.forEach(loopName => {
                 rootItem[loopName] = groupItems;
             });
             return rootItem;
          });
      }

      const formData = new FormData();
      formData.append('template', docxFile);
      formData.append('data', JSON.stringify(finalData));
      formData.append('mapping', JSON.stringify({})); 
      formData.append('deliveryMethod', deliveryMethod);
      formData.append('email', email);

      const res = await fetch('/api/generate', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
          const errData = await res.json();
          throw new Error(errData.error || 'Failed to generate certificates');
      }

      if (deliveryMethod === 'download') {
          const blob = await res.blob();
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'certificates.zip';
          document.body.appendChild(a);
          a.click();
          window.URL.revokeObjectURL(url);
          document.body.removeChild(a);
      } else {
          const data = await res.json();
          setSuccessMessage(data.message || 'Email sent successfully!');
      }

    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Error generating certificates. Please try again.');
    } finally {
      setGenerating(false);
    }
  };

  const isReady = docxFile && csvFile && docxPlaceholders.length > 0 && Object.keys(mapping).length > 0;
  const isGroupingValid = !enableGrouping || (enableGrouping && groupByCol !== '');
  const isDeliveryValid = deliveryMethod === 'download' || (deliveryMethod === 'email' && email.includes('@'));

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
        
        {/* Delivery Method Section */}
        {isReady && isGroupingValid && (
           <div className="bg-white shadow-sm rounded-lg p-6 mb-8 border border-gray-200">
             <h2 className="text-xl font-semibold mb-4 text-gray-800">5. Delivery Method</h2>
             <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
               <label className={clsx("cursor-pointer border-2 rounded-lg p-4 flex items-center space-x-3 transition-colors", deliveryMethod === 'download' ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-blue-200')}>
                 <input 
                   type="radio" 
                   name="delivery" 
                   className="hidden" 
                   checked={deliveryMethod === 'download'} 
                   onChange={() => setDeliveryMethod('download')}
                 />
                 <div className={clsx("w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0", deliveryMethod === 'download' ? "border-blue-500" : "border-gray-300")}>
                    {deliveryMethod === 'download' && <div className="w-3 h-3 rounded-full bg-blue-500"></div>}
                 </div>
                 <div>
                   <span className="block font-medium text-gray-900 flex items-center"><Download className="w-4 h-4 mr-2"/> Download ZIP</span>
                   <span className="block text-sm text-gray-500">Directly download the file to your device.</span>
                 </div>
               </label>

               <label className={clsx("cursor-pointer border-2 rounded-lg p-4 flex items-center space-x-3 transition-colors", deliveryMethod === 'email' ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200 hover:border-indigo-200')}>
                 <input 
                   type="radio" 
                   name="delivery" 
                   className="hidden" 
                   checked={deliveryMethod === 'email'} 
                   onChange={() => setDeliveryMethod('email')}
                 />
                 <div className={clsx("w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0", deliveryMethod === 'email' ? "border-indigo-500" : "border-gray-300")}>
                    {deliveryMethod === 'email' && <div className="w-3 h-3 rounded-full bg-indigo-500"></div>}
                 </div>
                 <div>
                   <span className="block font-medium text-gray-900 flex items-center"><Mail className="w-4 h-4 mr-2"/> Send via Email (R2 Link)</span>
                   <span className="block text-sm text-gray-500">Upload to cloud and email the download link.</span>
                 </div>
               </label>
             </div>
             
             {deliveryMethod === 'email' && (
                 <div className="mt-4 animate-in fade-in slide-in-from-top-2">
                     <label className="block text-sm font-medium text-gray-700 mb-1">Recipient Email Address</label>
                     <input 
                        type="email"
                        required
                        className="block w-full max-w-md rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm p-2 border text-gray-900"
                        placeholder="you@example.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                     />
                     <p className="text-xs text-gray-500 mt-1">A secure 7-day download link will be sent here.</p>
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
           {successMessage && (
             <div className="text-green-600 bg-green-50 px-4 py-2 rounded-md text-sm font-medium flex items-center">
               <Mail className="w-4 h-4 mr-2"/> {successMessage}
             </div>
           )}
           
           <button
             onClick={handleGenerate}
             disabled={!isReady || generating || !isGroupingValid || !isDeliveryValid}
             className={clsx(
               "flex items-center justify-center px-8 py-4 rounded-full text-lg font-bold text-white shadow-lg transition-all transform hover:scale-105",
               (!isReady || generating || !isGroupingValid || !isDeliveryValid)
                 ? 'bg-gray-400 cursor-not-allowed' 
                 : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-blue-500/30'
             )}
           >
             {generating ? (
               <>
                 <Loader2 className="animate-spin w-6 h-6 mr-2" />
                 Processing...
               </>
             ) : (
               <>
                 {deliveryMethod === 'email' ? <Mail className="w-6 h-6 mr-2" /> : <Download className="w-6 h-6 mr-2" />}
                 {deliveryMethod === 'email' ? 'Generate & Email Link' : 'Generate & Download ZIP'}
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