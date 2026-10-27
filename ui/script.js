import Chart from 'chart.js/auto';


const fileSelector = document.querySelector(".fileSelector");
const dataPreview  = document.querySelector(".dataPreview--container");
const ctx          = document.getElementById("chart");
const spinner      = document.querySelector(".loading--spinner");
const exportButton = document.querySelector(".chart-export");


exportButton.disabled = true;


const reader  = new FileReader();

const PAGE_SIZE = 10;



function normalize_data(data) {
	data = data.split("\n");
	const colNames = data[0].split(",").map(col => col.trim().toLowerCase());
	
	const normalizedData = []
	for (let r = 1; r < data.length - 1; r++) {
			const entry = {};
			
			const row = data[r].split(",").map(val => val.trim());
			for (let i = 0; i < colNames.length; i++) {
				if (row[i] === "undefined") entry[colNames[i].toLowerCase()] = "";
				else entry[colNames[i].toLowerCase()] = row[i];
			}

			normalizedData.push(entry);
		}

	return normalizedData;
}


function getAxis(data, xIdentifier, yIdentifier) {
	for (const [_, value] of Object.entries(data)) {
		for (let i = 0; i < value.length; i++) {
			value[i] = {x : value[i][xIdentifier], y : value[i][yIdentifier]};
		}
	}
	
	// can return data, since we modified arrays that the original data object references
	return data
}

function groupData(data, cols) {
	const result = Object.groupBy(data, (item) => {
		return cols.map(col => `${col}_${item[col.toLowerCase()]}`).join("/");
	});

	return result;
}


// the small model sometimes wraps the json in markdown fences or adds text around it, this cuts out just the object
function parseResponse(raw) {
	if (typeof raw !== "string") return raw;

	const start = raw.indexOf("{");
	const end   = raw.lastIndexOf("}");
	if (start === -1 || end === -1) throw new Error(`no json object found in: ${raw}`);

	const cleaned = raw.slice(start, end + 1).replace(/,\s*([}\]])/g, "$1");

	try {
		return JSON.parse(cleaned);
	} catch (err) {
		console.log("model response that failed to parse:", raw);
		throw err;
	}
}


// decides which columns split the rows into datasets, groupBy columns that are just the axes get skipped, series is added on top
function getGroupCols(spec) {
	const axes = [spec.fields.x, spec.fields.y, spec.fields.size];
	const cols = spec.transform.groupBy.filter(col => !axes.includes(col));

	if (spec.fields.series && !cols.includes(spec.fields.series)) cols.push(spec.fields.series);

	return cols;
}


// same as getAxis but bubbles also need a size value
function getBubbleAxis(data, xIdentifier, yIdentifier, sizeIdentifier) {
	for (const [_, value] of Object.entries(data)) {
		for (let i = 0; i < value.length; i++) {
			value[i] = {x : value[i][xIdentifier], y : value[i][yIdentifier], size : value[i][sizeIdentifier]};
		}
	}

	return data
}


// turns the csv strings into real numbers and throws away points that arent numeric
function castPoints(data, keys) {
	for (const [name, value] of Object.entries(data)) {
		data[name] = value
			.map(point => {
				const casted = { ...point };
				for (const key of keys) casted[key] = parseFloat(point[key]);
				return casted;
			})
			.filter(point => keys.every(key => !isNaN(point[key])));
	}

	return data;
}


// chartjs bubbles want a radius in pixels, so this maps the size column onto a min/max radius
function scaleBubbles(data, minRadius = 4, maxRadius = 30) {
	const sizes = Object.values(data).flatMap(points => points.map(point => point.size));
	if (sizes.length === 0) return data;

	const min = sizes.reduce((a, b) => Math.min(a, b));
	const max = sizes.reduce((a, b) => Math.max(a, b));

	for (const [_, value] of Object.entries(data)) {
		for (let i = 0; i < value.length; i++) {
			value[i].r = minRadius + ((value[i].size - min) / ((max - min) || 1)) * (maxRadius - minRadius);
		}
	}

	return data;
}


// wraps each group of points into a chartjs dataset, uses a fallback name when the group has no key
function getDatasets(data, fallbackLabel) {
	return Object.entries(data).map(([key, points]) => ({
		label: key || fallbackLabel,
		data: points
	}));
}


// aggregates a list of values into one number, none counts as sum
function aggregateValues(values, aggregation) {
	if (aggregation === "count") return values.length;

	const numbers = values.map(val => parseFloat(val)).filter(val => !isNaN(val));
	if (numbers.length === 0) return 0;

	switch (aggregation) {
		case "mean":
			return numbers.reduce((a, b) => a + b, 0) / numbers.length;
		case "min":
			return numbers.reduce((a, b) => Math.min(a, b));
		case "max":
			return numbers.reduce((a, b) => Math.max(a, b));
		default:
			return numbers.reduce((a, b) => a + b, 0);
	}
}


// cleans up line points after getAxis, aggregates per x if asked, makes y numeric and sorts only when the model asked for it
function getLinePoints(data, fields, transform) {
	const sortBy    = transform.sortBy ? transform.sortBy.toLowerCase() : null;
	const sortKey   = sortBy === fields.x.toLowerCase() ? "x" : sortBy === fields.y.toLowerCase() ? "y" : null;
	const direction = transform.sortOrder === "descending" ? -1 : 1;

	for (const [name, points] of Object.entries(data)) {
		let result = points;

		if (transform.aggregation !== "none") {
			const byX = Object.groupBy(points, point => point.x);
			result = Object.entries(byX).map(([x, group]) => ({
				x: x,
				y: aggregateValues(group.map(point => point.y), transform.aggregation)
			}));
		}

		result = result
			.map(point => ({ x : point.x, y : parseFloat(point.y) }))
			.filter(point => !isNaN(point.y));

		if (sortKey && transform.sortOrder !== "none") {
			result.sort((a, b) => {
				if (sortKey === "y") return direction * (a.y - b.y);
				return direction * String(a.x).localeCompare(String(b.x), undefined, { numeric: true });
			});
		}

		data[name] = result;
	}

	return data;
}


// sorts labels and their dataset values together, by label or by total value
function sortCategories(labels, datasets, sortBy, sortOrder, categoryId, valueId) {
	if (!sortBy || sortOrder === "none") return { labels, datasets };
	if (sortBy !== categoryId && sortBy !== valueId) return { labels, datasets };

	const order = labels.map((_, i) => i);
	const direction = sortOrder === "descending" ? -1 : 1;

	order.sort((a, b) => {
		if (sortBy === categoryId) {
			return direction * String(labels[a]).localeCompare(String(labels[b]), undefined, { numeric: true });
		}

		const totalA = datasets.reduce((sum, set) => sum + set.data[a], 0);
		const totalB = datasets.reduce((sum, set) => sum + set.data[b], 0);
		return direction * (totalA - totalB);
	});

	return {
		labels: order.map(i => labels[i]),
		datasets: datasets.map(set => ({ ...set, data: order.map(i => set.data[i]) }))
	};
}


// builds labels + datasets for bar, pie, doughnut, polarArea and radar, one value per category (and per series if there is one)
function getCategories(data, fields, transform) {
	const categoryId = fields.category.toLowerCase();
	const valueId    = fields.value.toLowerCase();
	const seriesId   = fields.series ? fields.series.toLowerCase() : null;

	const labels  = [...new Set(data.map(row => row[categoryId]))];
	const grouped = seriesId ? Object.groupBy(data, row => row[seriesId]) : { [fields.value] : data };

	const datasets = Object.entries(grouped).map(([key, rows]) => {
		const byCategory = Object.groupBy(rows, row => row[categoryId]);

		return {
			label: key,
			data: labels.map(label => aggregateValues((byCategory[label] || []).map(row => row[valueId]), transform.aggregation))
		};
	});

	return sortCategories(labels, datasets, transform.sortBy ? transform.sortBy.toLowerCase() : null, transform.sortOrder, categoryId, valueId);
}


// destroys the chart thats already on the canvas, otherwise chartjs complains the canvas is in use
function clearChart() {
	const existing = Chart.getChart(ctx);
	if (existing) existing.destroy();
}


function getHeaders(raw) {
	const end = raw.indexOf("\n");
	return raw.slice(0, end === -1 ? raw.length : end).split(",").map(col => col.trim());
}


function buildElement(tag, className = "", text = "") {
	const element = document.createElement(tag);
	if (className) element.className = className;
	element.textContent = text;
	return element;
}


function renderPreview(headers, data) {
	const totalPages = Math.max(1, Math.ceil(data.length / PAGE_SIZE));
	let page = 0;

	const wrapper   = buildElement("div", "dataPreview--tableWrapper");
	const table     = buildElement("table", "dataPreview--table");
	const thead     = buildElement("thead");
	const tbody     = buildElement("tbody");
	const headRow   = buildElement("tr");

	const controls  = buildElement("div", "dataPreview--controls");
	const status    = buildElement("span", "dataPreview--status");
	const pager     = buildElement("div", "dataPreview--pager");
	const prev      = buildElement("button", "dataPreview--button button", "Previous");
	const pageLabel = buildElement("span", "dataPreview--page");
	const next      = buildElement("button", "dataPreview--button button", "Next");

	prev.type = "button";
	next.type = "button";

	headRow.append(buildElement("th", "dataPreview--index", "#"));
	for (const header of headers) headRow.append(buildElement("th", "", header));

	thead.append(headRow);
	table.append(thead, tbody);
	wrapper.append(table);
	pager.append(prev, pageLabel, next);
	controls.append(status, pager);

	function showPage(target) {
		page = Math.min(Math.max(target, 0), totalPages - 1);

		const start = page * PAGE_SIZE;
		const rows  = data.slice(start, start + PAGE_SIZE).map((entry, i) => {
			const row = buildElement("tr");
			row.append(buildElement("td", "dataPreview--index", start + i + 1));
			for (const header of headers) row.append(buildElement("td", "", entry[header.toLowerCase()] ?? ""));
			return row;
		});

		tbody.replaceChildren(...rows);

		status.textContent    = data.length === 0 ? "0 rows" : `${start + 1}–${start + rows.length} of ${data.length} rows`;
		pageLabel.textContent = `${page + 1} / ${totalPages}`;
		prev.disabled         = page === 0;
		next.disabled         = page === totalPages - 1;
	}

	prev.addEventListener("click", () => showPage(page - 1));
	next.addEventListener("click", () => showPage(page + 1));

	showPage(0);
	dataPreview.replaceChildren(wrapper, controls);
}


const exportButtonHandler = () => {
	console.log("clicked");

	const img = ctx.toDataURL();
	const downloadLink = document.createElement('a');

	downloadLink.download = new Date().toUTCString();
	downloadLink.href = img;

	downloadLink.click();
}

function renderChart(datasets, xLabel = 'X Axis', yLabel = 'Y Axis', type = 'line', labels = undefined, stacked = false, horizontal = false) {
	spinner.classList.add("hidden");
	exportButton.disabled = false;

    new Chart(ctx, {
        type: type,
        data: { labels, datasets },
        options: {
            responsive: true,
            indexAxis: horizontal ? 'y' : 'x',
            scales: {
                x: {
                    position: 'bottom',
                    stacked: stacked,
                    title: {
                        display: true,
                        text: xLabel
                    }
                },
                y: {
                    stacked: stacked,
                    title: {
                        display: true,
                        text: yLabel
                    }
                }
            }
        }
    });

	exportButton.addEventListener("click", exportButtonHandler); 
}


// pie, doughnut, polarArea and radar dont use x/y axes so they get their own render function
function renderRadialChart(type, labels, datasets, filled = false) {
	spinner.classList.add("hidden");
	exportButton.disabled = false;

	new Chart(ctx, {
		type: type,
		data: {
			labels,
			datasets: datasets.map(set => ({ ...set, fill: filled }))
		},
		options: {
			responsive: true
		}
	});
	
	exportButton.addEventListener("click", exportButtonHandler); 
}


fileSelector.addEventListener("change", () => {
	const file = fileSelector.files[0];
	reader.readAsText(file);

	clearChart();
	exportButton.removeEventListener("click", exportButtonHandler);	

	spinner.classList.remove("hidden");
});


reader.addEventListener("load", () => {
	let normalizedData;

	fetch("http://127.0.0.1:8000", {
		method  : "POST",
		headers : {
			"content-type"   : "text/plain",
			"content-length" : reader.result.length,
		},
		body    : reader.result
	})
		.then(v => v.json())
			.then(v => {
				const desirialized = parseResponse(v);
				
				switch (desirialized.type) {
					case "line":
						const grouped = groupData(normalizedData, getGroupCols(desirialized));
						getAxis(grouped, desirialized.fields.x.toLowerCase(), desirialized.fields.y.toLowerCase()); 
						getLinePoints(grouped, desirialized.fields, desirialized.transform);
						const dataset = getDatasets(grouped, desirialized.fields.y).map(set => ({ ...set, fill: desirialized.options.filled }));

						console.log(dataset);

						renderChart(dataset, desirialized.fields.x, desirialized.fields.y, "line", undefined, desirialized.options.stacked);
						break;

					case "scatter": {
						const grouped = groupData(normalizedData, getGroupCols(desirialized));
						getAxis(grouped, desirialized.fields.x.toLowerCase(), desirialized.fields.y.toLowerCase());
						castPoints(grouped, ["x", "y"]);

						renderChart(getDatasets(grouped, desirialized.fields.y), desirialized.fields.x, desirialized.fields.y, "scatter");
						break;
					}

					case "bubble": {
						const grouped = groupData(normalizedData, getGroupCols(desirialized));
						getBubbleAxis(grouped, desirialized.fields.x.toLowerCase(), desirialized.fields.y.toLowerCase(), desirialized.fields.size.toLowerCase());
						castPoints(grouped, ["x", "y", "size"]);
						scaleBubbles(grouped);

						renderChart(getDatasets(grouped, desirialized.fields.y), desirialized.fields.x, desirialized.fields.y, "bubble");
						break;
					}

					case "bar": {
						const horizontal = desirialized.options.orientation === "horizontal";
						const categorical = getCategories(normalizedData, desirialized.fields, desirialized.transform);

						renderChart(
							categorical.datasets,
							horizontal ? desirialized.fields.value : desirialized.fields.category,
							horizontal ? desirialized.fields.category : desirialized.fields.value,
							"bar",
							categorical.labels,
							desirialized.options.stacked,
							horizontal
						);
						break;
					}

					case "pie":
					case "doughnut":
					case "polarArea":
					case "radar": {
						const categorical = getCategories(normalizedData, desirialized.fields, desirialized.transform);

						renderRadialChart(desirialized.type, categorical.labels, categorical.datasets, desirialized.options.filled);
						break;
					}
				}
			})
	.catch(err => console.log(`An error has occured, ${err}`))
	
	normalizedData = normalize_data(reader.result);
	renderPreview(getHeaders(reader.result), normalizedData);
})
