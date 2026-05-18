export const SOURCE_POLICIES = {
    general: {
        trustedDomains: [
            'wikipedia.org',
            'britannica.com',
            'investopedia.com',
            'merriam-webster.com',
            'dictionary.cambridge.org',
            'oxfordlearnersdictionaries.com',
            'reuters.com',
            'apnews.com',
            'bbc.com',
            'bbc.co.uk',
            'aljazeera.com',
            'npr.org',
            'cnbc.com',
            'bloomberg.com',
            'wsj.com',
            'ft.com',
            'nytimes.com',
            'theguardian.com',
            'economist.com'
        ],
        preferredDomains: [
            'wikipedia.org',
            'britannica.com',
            'investopedia.com',
            'merriam-webster.com',
            'dictionary.cambridge.org'
        ]
    },
    sports: {
        trustedDomains: [
            'espn.com',
            'espncricinfo.com',
            'cricbuzz.com',
            'icc-cricket.com',
            'fifa.com',
            'uefa.com',
            'nba.com',
            'nfl.com',
            'mlb.com',
            'nhl.com',
            'atptour.com',
            'wtatennis.com',
            'formula1.com',
            'motogp.com',
            'ufc.com',
            'olympics.com',
            'reuters.com',
            'apnews.com',
            'bbc.com'
        ],
        preferredDomains: [
            'icc-cricket.com',
            'espncricinfo.com',
            'cricbuzz.com',
            'fifa.com',
            'uefa.com',
            'nba.com',
            'nfl.com',
            'atptour.com',
            'wtatennis.com',
            'formula1.com',
            'ufc.com',
            'olympics.com'
        ]
    },
    politics: {
        trustedDomains: [
            'pmindia.gov.in',
            'india.gov.in',
            'tn.gov.in',
            'gov.in',
            'gov.uk',
            'state.gov',
            'whitehouse.gov',
            'senate.gov',
            'house.gov',
            'europa.eu',
            'un.org',
            'parliament.uk',
            'congress.gov',
            'eci.gov.in',
            'reuters.com',
            'apnews.com',
            'bbc.com',
            'bbc.co.uk',
            'aljazeera.com',
            'npr.org'
        ],
        preferredDomains: [
            'pmindia.gov.in',
            'india.gov.in',
            'tn.gov.in',
            'gov.in',
            'gov.uk',
            'state.gov',
            'whitehouse.gov',
            'senate.gov',
            'house.gov',
            'europa.eu',
            'un.org',
            'eci.gov.in',
            'parliament.uk',
            'congress.gov'
        ]
    },
    finance: {
        trustedDomains: [
            'ecb.europa.eu',
            'frankfurter.dev',
            'xe.com',
            'oanda.com',
            'x-rates.com',
            'investing.com',
            'marketwatch.com',
            'bloomberg.com',
            'wsj.com',
            'ft.com',
            'cnbc.com',
            'reuters.com',
            'nasdaq.com',
            'nyse.com',
            'nseindia.com',
            'bseindia.com',
            'spglobal.com',
            'wfe.org',
            'cmegroup.com',
            'lme.com',
            'kitco.com',
            'mcxindia.com',
            'iocl.com',
            'hindustanpetroleum.com',
            'bharatpetroleum.in',
            'eia.gov'
        ],
        preferredDomains: [
            'ecb.europa.eu',
            'frankfurter.dev',
            'xe.com',
            'oanda.com',
            'x-rates.com',
            'bloomberg.com',
            'nasdaq.com',
            'nyse.com',
            'nseindia.com',
            'bseindia.com',
            'kitco.com',
            'mcxindia.com',
            'iocl.com',
            'hindustanpetroleum.com',
            'bharatpetroleum.in'
        ]
    },
    space_science: {
        trustedDomains: [
            'nasa.gov',
            'isro.gov.in',
            'esa.int',
            'jaxa.jp',
            'cnsa.gov.cn',
            'roscosmos.ru',
            'spacex.com',
            'blueorigin.com',
            'ula.com',
            'space.com',
            'scientificamerican.com',
            'nature.com',
            'science.org',
            'arxiv.org',
            'reuters.com',
            'apnews.com',
            'bbc.com'
        ],
        preferredDomains: [
            'isro.gov.in',
            'nasa.gov',
            'esa.int',
            'jaxa.jp',
            'cnsa.gov.cn',
            'spacex.com',
            'nature.com',
            'science.org'
        ]
    },
    science: {
        trustedDomains: [
            'nature.com',
            'science.org',
            'pnas.org',
            'cell.com',
            'sciencedirect.com',
            'springer.com',
            'link.springer.com',
            'arxiv.org',
            'pubmed.ncbi.nlm.nih.gov',
            'ncbi.nlm.nih.gov',
            'acs.org',
            'rsc.org',
            'iop.org',
            'aps.org',
            'aip.org',
            'iupac.org',
            'biorxiv.org',
            'medrxiv.org',
            'reuters.com',
            'apnews.com',
            'bbc.com'
        ],
        preferredDomains: [
            'nature.com',
            'science.org',
            'pnas.org',
            'cell.com',
            'arxiv.org',
            'pubmed.ncbi.nlm.nih.gov',
            'ncbi.nlm.nih.gov',
            'acs.org',
            'rsc.org',
            'aps.org',
            'biorxiv.org'
        ]
    },
    ai_ml: {
        trustedDomains: [
            'openai.com',
            'anthropic.com',
            'deepmind.google',
            'ai.google',
            'huggingface.co',
            'paperswithcode.com',
            'arxiv.org',
            'tensorflow.org',
            'pytorch.org',
            'nvidia.com',
            'microsoft.com',
            'google.com',
            'meta.com',
            'ai.meta.com',
            'reuters.com',
            'apnews.com',
            'bloomberg.com',
            'cnbc.com'
        ],
        preferredDomains: [
            'openai.com',
            'anthropic.com',
            'deepmind.google',
            'huggingface.co',
            'paperswithcode.com',
            'arxiv.org',
            'tensorflow.org',
            'pytorch.org',
            'nvidia.com'
        ]
    },
    tech: {
        trustedDomains: [
            'openai.com',
            'microsoft.com',
            'google.com',
            'nvidia.com',
            'amd.com',
            'ibm.com',
            'intel.com',
            'qualcomm.com',
            'arm.com',
            'apple.com',
            'developer.apple.com',
            'developer.android.com',
            'mozilla.org',
            'developer.mozilla.org',
            'w3.org',
            'ieee.org',
            'reuters.com',
            'apnews.com',
            'bloomberg.com',
            'cnbc.com'
        ],
        preferredDomains: [
            'openai.com',
            'microsoft.com',
            'google.com',
            'nvidia.com',
            'amd.com',
            'ibm.com',
            'intel.com',
            'qualcomm.com',
            'arm.com',
            'developer.mozilla.org',
            'w3.org',
            'ieee.org'
        ]
    },
    entertainment: {
        trustedDomains: [
            'imdb.com',
            'wikipedia.org',
            'rottentomatoes.com',
            'metacritic.com',
            'netflix.com',
            'primevideo.com',
            'disneyplus.com',
            'hotstar.com',
            'zee5.com',
            'sonyliv.com',
            'reuters.com',
            'bbc.com'
        ],
        preferredDomains: [
            'imdb.com',
            'wikipedia.org',
            'rottentomatoes.com',
            'netflix.com',
            'primevideo.com',
            'disneyplus.com'
        ]
    },
    health: {
        trustedDomains: [
            'who.int',
            'cdc.gov',
            'nih.gov',
            'medlineplus.gov',
            'mayoclinic.org',
            'nhs.uk',
            'pubmed.ncbi.nlm.nih.gov',
            'ncbi.nlm.nih.gov',
            'nejm.org',
            'thelancet.com',
            'jamanetwork.com',
            'reuters.com',
            'apnews.com',
            'bbc.com'
        ],
        preferredDomains: [
            'who.int',
            'cdc.gov',
            'nih.gov',
            'medlineplus.gov',
            'mayoclinic.org',
            'nhs.uk',
            'pubmed.ncbi.nlm.nih.gov',
            'ncbi.nlm.nih.gov'
        ]
    },
    legal: {
        trustedDomains: [
            'supremecourt.gov',
            'congress.gov',
            'law.cornell.edu',
            'justice.gov',
            'legislation.gov.uk',
            'indiacode.nic.in',
            'reuters.com',
            'apnews.com',
            'bbc.com'
        ],
        preferredDomains: [
            'supremecourt.gov',
            'congress.gov',
            'law.cornell.edu',
            'justice.gov',
            'legislation.gov.uk',
            'indiacode.nic.in'
        ]
    },
    cybersecurity: {
        trustedDomains: [
            'cisa.gov',
            'nist.gov',
            'mitre.org',
            'owasp.org',
            'cve.org',
            'first.org',
            'krebsonsecurity.com',
            'thehackernews.com',
            'reuters.com',
            'apnews.com'
        ],
        preferredDomains: [
            'cisa.gov',
            'nist.gov',
            'mitre.org',
            'owasp.org',
            'cve.org',
            'first.org'
        ]
    },
    climate_energy: {
        trustedDomains: [
            'ipcc.ch',
            'noaa.gov',
            'metoffice.gov.uk',
            'copernicus.eu',
            'iea.org',
            'eia.gov',
            'irena.org',
            'unep.org',
            'reuters.com',
            'apnews.com',
            'bbc.com'
        ],
        preferredDomains: [
            'ipcc.ch',
            'noaa.gov',
            'metoffice.gov.uk',
            'copernicus.eu',
            'iea.org',
            'eia.gov',
            'irena.org',
            'unep.org'
        ]
    },
    education: {
        trustedDomains: [
            'ed.gov',
            'unesco.org',
            'oecd.org',
            'coursera.org',
            'edx.org',
            'khanacademy.org',
            'reuters.com',
            'apnews.com',
            'bbc.com'
        ],
        preferredDomains: [
            'ed.gov',
            'unesco.org',
            'oecd.org',
            'coursera.org',
            'edx.org',
            'khanacademy.org'
        ]
    }
};

function normalizeDomainKey(domain) {
    const raw = String(domain || '').trim().toLowerCase();
    if (!raw) return 'general';
    if (raw === 'space_science' || raw === 'space science' || raw === 'space-tech' || raw === 'space_tech') return 'space_science';
    if (raw === 'ai_ml' || raw === 'ai ml' || raw === 'aiml' || raw === 'ai') return 'ai_ml';
    if (raw === 'climate_energy' || raw === 'climate energy' || raw === 'climate') return 'climate_energy';
    return raw.replace(/[\s-]+/g, '_');
}

export function detectQueryDomain(text) {
    const t = String(text || '').toLowerCase();
    if (/\b(climate|global warming|carbon emissions?|ghg|greenhouse gas|renewable|solar|wind power|clean energy|grid|battery storage|decarboni[sz]ation|net zero)\b/.test(t)) {
        return 'climate_energy';
    }
    if (/\b(health|medical|medicine|disease|symptom|treatment|drug|vaccine|hospital|clinical trial|diagnosis|mental health|public health)\b/.test(t)) {
        return 'health';
    }
    if (/\b(law|legal|statute|act|bill|constitution|supreme court|high court|judgment|judgement|case law|section \d+|ipc|crpc)\b/.test(t)) {
        return 'legal';
    }
    if (/\b(cybersecurity|cyber security|malware|ransomware|phishing|zero day|zero-day|vulnerability|cve-\d{4}-\d+|exploit|infosec)\b/.test(t)) {
        return 'cybersecurity';
    }
    if (/\b(education|curriculum|syllabus|university|college|school|exam|admission|scholarship|tuition)\b/.test(t)) {
        return 'education';
    }
    if (/\b(isro|nasa|esa|jaxa|spacex|rocket|mission|orbiter|lunar|moon|mars|satellite|space station|astronaut)\b/.test(t)) {
        return 'space_science';
    }
    if (/\b(score|scores|winner|won|champion|standings|ranking|rankings|stats|team|player|match|tournament|league|season|ipl|psl|bbl|cpl|isl|pkl|ucl|uel|epl|nba|nfl|mlb|nhl|atp|wta|f1|motogp|fifa|uefa|olympics|world cup)\b/.test(t)) {
        return 'sports';
    }
    if (/\b(stock|stocks|share|shares|market|market cap|earnings|price|repo rate|interest rate|inflation|forex|exchange rate|rbi|sebi|imf|gold|silver|platinum|diamond|palladium|petrol|diesel|gasoline|crude|brent|wti|commodity|fuel)\b/.test(t)) {
        return 'finance';
    }
    if (/\b(real estate|real-estate|property market|housing market|mortgage|home loan)\b/.test(t)) {
        return 'finance';
    }
    if (/\b(president|prime minister|pm|chief minister|cm|election|party|government|minister|parliament|senate|diplomacy|geopolitics|foreign policy|cabinet|bill passed|legislation|sanctions|bjp|aap|dmk|aiadmk|tdp|ysrcp|bjd|nato|eu)\b/.test(t)) {
        return 'politics';
    }
    if (/\b(ai|artificial intelligence|llm|gpt|chatgpt|claude|gemini|mistral|llama|transformer|diffusion|rag|prompt engineering|multimodal|agentic|fine[- ]tuning|embedding|vector database|huggingface|paperswithcode)\b/.test(t)) {
        return 'ai_ml';
    }
    if (/\b(physics|quantum|relativity|thermodynamics|electromagnetism|optics|particle physics|chemistry|organic chemistry|inorganic chemistry|biochemistry|biology|genetics|genomics|microbiology|cell biology|ecology|molecular|enzyme|reaction mechanism|periodic table)\b/.test(t)) {
        return 'science';
    }
    if (/\b(gpu|cpu|chip|software|hardware|startup|company|ceo|founder|cloud|kubernetes|docker|linux|windows|android|ios|tcs|ibm|amd|intel|apple|qualcomm|arm)\b/.test(t)) {
        return 'tech';
    }
    if (/\b(actor|actress|movie|film|films|cinema|director|producer|singer|song|songs|album|albums|show|series|web series|filmography|discography|imdb|box office|release)\b/.test(t)) {
        return 'entertainment';
    }
    return 'general';
}

export function getDomainHints(domain) {
    switch (normalizeDomainKey(domain)) {
        case 'sports':
            return {
                primary: 'sports',
                secondary: 'league team match',
                context: 'official standings results',
                fresh: 'latest score result',
                official: 'official site result'
            };
        case 'finance':
            return {
                primary: 'finance',
                secondary: 'stock commodity fuel market',
                context: 'official exchange commodity pricing',
                fresh: 'latest price market update',
                official: 'Bloomberg Reuters Nasdaq NYSE NSE BSE official prices'
            };
        case 'space_science':
            return {
                primary: 'space mission',
                secondary: 'isro nasa esa',
                context: 'official space agency update',
                fresh: 'latest mission update',
                official: 'isro.gov.in nasa.gov official statement'
            };
        case 'science':
            return {
                primary: 'science research',
                secondary: 'physics chemistry biology',
                context: 'peer reviewed source',
                fresh: 'latest research update',
                official: 'nature science arxiv pubmed source'
            };
        case 'ai_ml':
            return {
                primary: 'ai machine learning',
                secondary: 'llm model release benchmark',
                context: 'official model announcement and paper',
                fresh: 'latest model update',
                official: 'openai anthropic huggingface arxiv source'
            };
        case 'politics':
            return {
                primary: 'politics',
                secondary: 'party government election',
                context: 'official government source',
                fresh: 'latest update news',
                official: 'official government statement'
            };
        case 'tech':
            return {
                primary: 'technology',
                secondary: 'company product research',
                context: 'official company source',
                fresh: 'latest update',
                official: 'official announcement'
            };
        case 'entertainment':
            return {
                primary: 'entertainment',
                secondary: 'filmography movie release',
                context: 'imdb wikipedia filmography',
                fresh: 'latest release filmography',
                official: 'official movie page imdb'
            };
        case 'health':
            return {
                primary: 'health medicine',
                secondary: 'clinical guidance evidence',
                context: 'trusted medical authority source',
                fresh: 'latest health advisory update',
                official: 'WHO CDC NIH guidance'
            };
        case 'legal':
            return {
                primary: 'law legal statute',
                secondary: 'court judgment legislation',
                context: 'official legal text source',
                fresh: 'latest legal update',
                official: 'official government or court source'
            };
        case 'cybersecurity':
            return {
                primary: 'cybersecurity threat advisory',
                secondary: 'cve exploit vulnerability',
                context: 'official security advisory',
                fresh: 'latest security advisory',
                official: 'CISA NIST MITRE CVE source'
            };
        case 'climate_energy':
            return {
                primary: 'climate energy',
                secondary: 'emissions renewable policy',
                context: 'official climate data source',
                fresh: 'latest climate energy update',
                official: 'IPCC NOAA IEA official report'
            };
        case 'education':
            return {
                primary: 'education policy',
                secondary: 'university school exam',
                context: 'official education source',
                fresh: 'latest education update',
                official: 'government or UNESCO OECD source'
            };
        default:
            return {
                primary: 'official',
                secondary: 'reference',
                context: 'reliable source',
                fresh: 'latest update',
                official: 'official source'
            };
    }
}

export function getTrustedSourceHintForDomain(domain) {
    const d = normalizeDomainKey(domain);
    if (d === 'sports') return 'site:espncricinfo.com OR site:iplt20.com OR site:fifa.com';
    if (d === 'finance') return 'site:reuters.com OR site:bloomberg.com OR site:marketwatch.com OR site:investopedia.com';
    if (d === 'politics') return 'site:reuters.com OR site:apnews.com OR site:bbc.com OR site:pmindia.gov.in OR site:india.gov.in OR site:tn.gov.in OR site:gov.in OR site:gov.uk';
    if (d === 'space_science') return 'site:nasa.gov OR site:isro.gov.in OR site:esa.int';
    if (d === 'science') return 'site:nature.com OR site:science.org OR site:arxiv.org OR site:pubmed.ncbi.nlm.nih.gov';
    if (d === 'ai_ml') return 'site:openai.com OR site:anthropic.com OR site:huggingface.co OR site:arxiv.org';
    if (d === 'entertainment') return 'site:imdb.com OR site:wikipedia.org';
    if (d === 'health') return 'site:who.int OR site:cdc.gov OR site:nih.gov OR site:mayoclinic.org';
    if (d === 'legal') return 'site:congress.gov OR site:supremecourt.gov OR site:law.cornell.edu OR site:indiacode.nic.in';
    if (d === 'cybersecurity') return 'site:cisa.gov OR site:nist.gov OR site:mitre.org OR site:cve.org';
    if (d === 'climate_energy') return 'site:ipcc.ch OR site:noaa.gov OR site:iea.org OR site:eia.gov';
    if (d === 'education') return 'site:ed.gov OR site:unesco.org OR site:oecd.org';
    return 'site:wikipedia.org OR site:britannica.com OR site:investopedia.com OR site:merriam-webster.com';
}
